import { procurementRepository, convertPO } from './repository'
import { PurchaseOrderInput, ReceivePOInput, AddLineItemInput, UpdatePOInput } from './validation'
import { PurchaseOrder, SupplierInvoice, PaymentMade, SupplierInvoiceStatus } from './types'
import { AppError } from '../../middleware/errorHandler'
import { createChildLogger } from '../../logger'
import { prisma } from '../../database'
import { inventoryService } from '../inventory/service'
import { financeService } from '../finance/service'
import { decomposeInclusive } from '../../lib/vat-utils'
import { dateFromInput } from '../../utils/dates'
import { supplierService } from '../suppliers/service'
import { getCurrentTenantId } from '../../context'
import { requireTenantId } from '../../middleware/tenant'
import { Prisma, PrismaClient } from '@prisma/client'

type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

const logger = createChildLogger('procurement:service')

// Packaging components live in 1311 (single home — see P2a/P2b decision log).
// 1510 (packing-bag resale) is dormant legacy.
const PACKAGING_ACCOUNT = '1311'
const RAW_ACCOUNT = '1300'

async function generateSupplierInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear()
  const count = await prisma.supplierInvoice.count({
    where: {
      invoiceNumber: { startsWith: `SI-${year}-` }
    }
  })
  return `SI-${year}-${String(count + 1).padStart(3, '0')}`
}

async function assertMaterialsActive(materialIds: string[]) {
  const unique = [...new Set(materialIds)]
  const materials = await prisma.material.findMany({
    where: { id: { in: unique } },
    select: { id: true, code: true, isActive: true }
  })
  if (materials.length !== unique.length) {
    throw new AppError(404, 'NOT_FOUND', 'One or more materials were not found')
  }
  const archived = materials.filter(m => !m.isActive)
  if (archived.length > 0) {
    throw new AppError(400, 'INACTIVE_MATERIAL', `Materials are archived: ${archived.map(m => m.code).join(', ')}`)
  }
  return materials
}

/** Line value in the material's own unit of measure. */
function lineValue(quantity: number, unitPrice: number): number {
  return Number(quantity) * Number(unitPrice)
}

function toJeDateStr(date: string | Date): string {
  if (typeof date === 'string') return date
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * Core supplier-invoice creation logic. Runs within the caller's transaction
 * so it can be composed with receivePO (atomic receive+invoice) or called
 * standalone from createSupplierInvoice.
 */
async function createInvoiceInTx(
  tx: TxClient,
  poId: string,
  poSupplier: string,
  poItems: { materialId: string; quantity: number; unitPrice: number }[],
  amount: number,
  date: string | Date,
  invoiceNumber?: string
): Promise<SupplierInvoice> {
  const supplier = await supplierService.findOrCreateByName(poSupplier)

  const settings = await prisma.settings.findFirst()
  const vatRate = settings?.vatRate ? Number(settings.vatRate) : 7.5
  const { exclusive: totalExclusive, vat: totalVat } = decomposeInclusive(amount, vatRate)

  let rawMaterialExclusive = totalExclusive
  let packagingExclusive = 0
  if (poItems.length > 0) {
    let rawTotal = 0
    let packagingTotal = 0
    for (const item of poItems) {
      const material = await tx.material.findUnique({ where: { id: item.materialId } })
      const itemTotal = lineValue(item.quantity, item.unitPrice)
      if (material?.category === 'PACKAGING') {
        packagingTotal += itemTotal
      } else {
        rawTotal += itemTotal
      }
    }
    const grandTotal = rawTotal + packagingTotal
    if (grandTotal > 0) {
      rawMaterialExclusive = totalExclusive * (rawTotal / grandTotal)
      packagingExclusive = totalExclusive * (packagingTotal / grandTotal)
    }
  }

  const jeDateStr = toJeDateStr(date)
  const finalInvoiceNumber = invoiceNumber || await generateSupplierInvoiceNumber()

  // 1. Create the SupplierInvoice record
  const createdInvoice = await tx.supplierInvoice.create({
    data: {
      poId,
      supplierId: supplier.id,
      invoiceNumber: finalInvoiceNumber,
      date: typeof date === 'string' ? dateFromInput(date) : date,
      amount,
      status: 'PENDING',
      amountPaid: 0,
      tenantId: requireTenantId()
    },
    include: { po: true, supplier: true, payments: true }
  })

  // 2. Post the journal entry (double-entry bookkeeping)
  const rawMaterialAccountId = await financeService.getAccountIdByCode('1300')
  const packagingAccountId = await financeService.getAccountIdByCode(PACKAGING_ACCOUNT)
  const vatInputId = await financeService.getAccountIdByCode('1400')
  const apAccountId = await financeService.getAccountIdByCode('2000')

  const lines: { accountId: string; debit: number; credit: number; memo?: string }[] = []
  if (rawMaterialExclusive > 0) {
    lines.push({ accountId: rawMaterialAccountId, debit: rawMaterialExclusive, credit: 0, memo: 'Raw material inventory (excl. VAT)' })
  }
  if (packagingExclusive > 0) {
    lines.push({ accountId: packagingAccountId, debit: packagingExclusive, credit: 0, memo: 'Packaging inventory (excl. VAT)' })
  }
  if (totalVat > 0) {
    lines.push({ accountId: vatInputId, debit: totalVat, credit: 0, memo: 'Input VAT on purchase' })
  }
  lines.push({ accountId: apAccountId, debit: 0, credit: amount, memo: `Supplier invoice ${finalInvoiceNumber}` })

  await financeService.postJournalEntry({
    description: `Supplier Invoice ${finalInvoiceNumber} - ${poSupplier}`,
    sourceModule: 'PROCUREMENT',
    sourceId: createdInvoice.id,
    reference: finalInvoiceNumber,
    date: jeDateStr,
    lines
  }, tx)

  // 3. Update material cost prices from PO line item prices
  for (const item of poItems) {
    if (Number(item.unitPrice) > 0) {
      await tx.material.update({
        where: { id: item.materialId },
        data: { costPrice: item.unitPrice }
      })
    }
  }

  return { id: createdInvoice.id, poId: createdInvoice.poId, supplierId: createdInvoice.supplierId, invoiceNumber: createdInvoice.invoiceNumber, date: createdInvoice.date, amount: Number(createdInvoice.amount), status: createdInvoice.status, amountPaid: Number(createdInvoice.amountPaid), createdAt: createdInvoice.createdAt } as unknown as SupplierInvoice
}

export const procurementService = {
  // Purchase Orders
  async getAllPOs(status?: string, excludeInvoiced?: boolean): Promise<PurchaseOrder[]> {
    return procurementRepository.findAllPOs({ status, excludeInvoiced })
  },

  async getPOById(id: string): Promise<PurchaseOrder> {
    const po = await procurementRepository.findPOById(id)
    if (!po) throw new AppError(404, 'NOT_FOUND', 'Purchase order not found')
    return po
  },

  async createPO(input: PurchaseOrderInput, userId?: string): Promise<PurchaseOrder> {
    const totalAmount = input.items.reduce((sum, item) => {
      return sum + (Number(item.quantity) * Number(item.unitPrice))
    }, 0)

    await assertMaterialsActive(input.items.map(i => i.materialId))

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const poNumber = await procurementRepository.generatePONumber()
        logger.info({ poNumber, supplier: input.supplier, items: input.items.length }, 'Creating purchase order with line items')

        return await procurementRepository.createPOWithItems({
          poNumber,
          supplier: input.supplier,
          expectedDate: input.expectedDate ? dateFromInput(input.expectedDate) : undefined,
          issuedDate: input.issuedDate ? dateFromInput(input.issuedDate) : undefined,
          notes: input.notes,
          createdById: userId,
          totalAmount,
          items: input.items.map(item => ({
            materialId: item.materialId,
            quantity: item.quantity,
            unitPrice: item.unitPrice
          }))
        })
      } catch (error: any) {
        if (error?.code === 'P2002' && attempt < 3) {
          logger.warn({ attempt }, 'PO number collision, retrying...')
          continue
        }
        throw error
      }
    }
    throw new AppError(500, 'PO_CREATION_FAILED', 'Failed to create PO after multiple attempts')
  },

  async updatePO(id: string, input: UpdatePOInput): Promise<PurchaseOrder> {
    const existing = await procurementRepository.findPOById(id)
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Purchase order not found')
    if (existing.status !== 'PENDING') {
      throw new AppError(400, 'INVALID_OPERATION', 'Can only edit pending purchase orders')
    }

    if (input.items) {
      const totalAmount = input.items.reduce((sum, item) => {
        return sum + (Number(item.quantity) * Number(item.unitPrice))
      }, 0)

      return prisma.$transaction(async (tx) => {
        await tx.pOLineItem.deleteMany({ where: { purchaseOrderId: id } })
        for (const item of input.items!) {
          await tx.pOLineItem.create({
            data: {
              purchaseOrderId: id,
              materialId: item.materialId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              tenantId: requireTenantId()
            }
          })
        }
        const updated = await tx.purchaseOrder.update({
          where: { id },
          data: {
            supplier: input.supplier,
            expectedDate: input.expectedDate ? dateFromInput(input.expectedDate) : undefined,
            notes: input.notes,
            totalAmount
          },
          include: { items: { include: { material: true } } }
        })
        return convertPO(updated)
      })
    }

    logger.info({ poId: id, updates: input }, 'Updating purchase order')
    return procurementRepository.updatePO(id, {
      supplier: input.supplier,
      expectedDate: input.expectedDate ? dateFromInput(input.expectedDate) : undefined,
      notes: input.notes
    })
  },

  async addLineItem(poId: string, input: AddLineItemInput): Promise<PurchaseOrder> {
    const existing = await procurementRepository.findPOById(poId)
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Purchase order not found')
    if (existing.status !== 'PENDING') {
      throw new AppError(400, 'INVALID_OPERATION', 'Can only edit pending purchase orders')
    }

    logger.info({ poId, materialId: input.materialId }, 'Adding line item to PO')
    await prisma.pOLineItem.create({
      data: {
        purchaseOrderId: poId,
        materialId: input.materialId,
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        tenantId: requireTenantId()
      }
    })

    const po = await procurementRepository.findPOById(poId)
    if (!po) throw new AppError(404, 'NOT_FOUND', 'Purchase order not found')
    return po
  },

  async removeLineItem(poId: string, lineItemId: string): Promise<PurchaseOrder> {
    const existing = await procurementRepository.findPOById(poId)
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Purchase order not found')
    if (existing.status !== 'PENDING') {
      throw new AppError(400, 'INVALID_OPERATION', 'Can only edit pending purchase orders')
    }

    logger.info({ poId, lineItemId }, 'Removing line item from PO')
    await prisma.pOLineItem.delete({ where: { id: lineItemId } })

    const po = await procurementRepository.findPOById(poId)
    if (!po) throw new AppError(404, 'NOT_FOUND', 'Purchase order not found')
    return po
  },

  async deletePO(id: string): Promise<void> {
    const deleted = await prisma.purchaseOrder.deleteMany({
      where: { id, status: 'PENDING' }
    })
    if (deleted.count === 0) {
      const existing = await procurementRepository.findPOById(id)
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Purchase order not found')
      throw new AppError(400, 'INVALID_OPERATION', 'Can only delete pending purchase orders')
    }
    logger.info({ poId: id }, 'Purchase order deleted')
  },

  async receivePO(poId: string, userId?: string, date?: string, invoice?: { amount: number; date: string; invoiceNumber?: string }, receivedLines?: { lineItemId: string; receivedQty: number }[]): Promise<{ po: PurchaseOrder; invoice?: SupplierInvoice }> {
    return prisma.$transaction(async (tx) => {
      // Lock the PO row to serialize concurrent receives
      await tx.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${poId} AND "tenantId" = ${getCurrentTenantId()} FOR UPDATE`

      const poData = await tx.purchaseOrder.findUnique({
        where: { id: poId },
        include: { items: { include: { material: true } } }
      })
      const po = poData ? convertPO(poData) : null
      if (!po) throw new AppError(404, 'NOT_FOUND', 'Purchase order not found')
      if (po.status === 'RECEIVED') throw new AppError(400, 'INVALID_OPERATION', 'PO already fully received')
      if (po.status === 'CANCELLED') throw new AppError(400, 'INVALID_OPERATION', 'PO is cancelled')

      logger.info({ poId, lineItems: po.items?.length, partial: !!receivedLines }, 'Receiving purchase order into MAIN stock')

      // Build a lookup for partial receiving quantities
      const receivedMap = new Map<string, number>()
      if (receivedLines && receivedLines.length > 0) {
        for (const rl of receivedLines) {
          receivedMap.set(rl.lineItemId, rl.receivedQty)
        }
      }

      let allFullyReceived = true

      for (const lineItem of po.items || []) {
        const material = await tx.material.findUnique({ where: { id: lineItem.materialId } })
        if (!material) continue

        // Determine how much to receive for this line
        const qtyToReceive = receivedMap.has(lineItem.id)
          ? receivedMap.get(lineItem.id)!
          : Number(lineItem.quantity)

        if (qtyToReceive <= 0) continue

        const alreadyReceived = lineItem.receivedQty || 0
        const newTotalReceived = alreadyReceived + qtyToReceive

        await inventoryService.addStock(
          lineItem.materialId,
          qtyToReceive,
          `PO ${po.poNumber} received`,
          poId,
          userId,
          tx
        )

        await tx.pOLineItem.update({
          where: { id: lineItem.id },
          data: { receivedQty: newTotalReceived }
        })

        if (newTotalReceived < Number(lineItem.quantity)) {
          allFullyReceived = false
        }
      }

      const newStatus = allFullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED'
      const updatedPO = await tx.purchaseOrder.update({
        where: { id: poId },
        data: { status: newStatus as any, receivedDate: allFullyReceived ? dateFromInput(date) : null },
        include: { items: { include: { material: true } } }
      })

      logger.info({ poId, status: newStatus }, 'PO received')

      let createdInvoice: SupplierInvoice | undefined
      if (invoice) {
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            createdInvoice = await createInvoiceInTx(
              tx, poId, po.supplier, po.items || [],
              invoice.amount, invoice.date, invoice.invoiceNumber
            )
            break
          } catch (error: any) {
            if (error?.code === 'P2002' && attempt < 3) {
              logger.warn({ attempt }, 'Invoice number collision, retrying...')
              continue
            }
            throw error
          }
        }
      }

      return { po: convertPO(updatedPO), invoice: createdInvoice }
    })
  },

  async createCreditNote(input: { supplierId: string; poId?: string; amount: number; date: string; reason: string; materialId?: string; quantity?: number; notes?: string }, userId?: string): Promise<any> {
    const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId } })
    if (!supplier) throw new AppError(404, 'NOT_FOUND', 'Supplier not found')

    if (input.poId) {
      const po = await procurementRepository.findPOById(input.poId)
      if (!po) throw new AppError(404, 'NOT_FOUND', 'Purchase order not found')
    }

    // Generate credit note number
    const year = new Date().getFullYear()
    const count = await prisma.supplierCreditNote.count({
      where: { creditNoteNumber: { startsWith: `CN-${year}-` } }
    })
    const creditNoteNumber = `CN-${year}-${String(count + 1).padStart(3, '0')}`

    logger.info({ supplierId: input.supplierId, amount: input.amount, creditNoteNumber }, 'Creating supplier credit note')

    return prisma.$transaction(async (tx) => {
      // Create the credit note record
      const creditNote = await tx.supplierCreditNote.create({
        data: {
          creditNoteNumber,
          supplierId: input.supplierId,
          poId: input.poId || null,
          amount: input.amount,
          date: dateFromInput(input.date),
          reason: input.reason,
          materialId: input.materialId || null,
          quantity: input.quantity || null,
          notes: input.notes || null,
          tenantId: requireTenantId()
        }
      })

      // Determine inventory account based on material category
      let inventoryAccountCode = '1300'
      if (input.materialId) {
        const material = await tx.material.findUnique({ where: { id: input.materialId } })
        if (material?.category === 'PACKAGING') {
          inventoryAccountCode = '1311'
        }
      }

      const apAccountId = await financeService.getAccountIdByCode('2000')
      const inventoryAccountId = await financeService.getAccountIdByCode(inventoryAccountCode)

      // Post journal entry: Dr AP / Cr Inventory
      await financeService.postJournalEntry({
        description: `Supplier credit note ${creditNoteNumber} — ${supplier.name}. ${input.reason}`,
        sourceModule: 'PROCUREMENT',
        sourceId: creditNote.id,
        reference: creditNoteNumber,
        date: input.date,
        lines: [
          { accountId: apAccountId, debit: input.amount, credit: 0, memo: `Credit note ${creditNoteNumber}` },
          { accountId: inventoryAccountId, debit: 0, credit: input.amount, memo: `Returned to supplier — ${input.reason}` }
        ]
      }, tx)

      // If material+quantity specified, decrement stock
      if (input.materialId && input.quantity && input.quantity > 0) {
        await inventoryService.addStock(
          input.materialId,
          -input.quantity,
          `Returned to vendor — CN ${creditNoteNumber}`,
          creditNote.id,
          userId,
          tx
        )
      }

      return {
        id: creditNote.id,
        creditNoteNumber,
        supplierId: creditNote.supplierId,
        supplier: { id: supplier.id, name: supplier.name },
        poId: creditNote.poId,
        amount: Number(creditNote.amount),
        date: creditNote.date,
        reason: creditNote.reason,
        materialId: creditNote.materialId,
        quantity: creditNote.quantity,
        notes: creditNote.notes,
        createdAt: creditNote.createdAt
      }
    })
  },

  async getAllCreditNotes(): Promise<any[]> {
    const notes = await prisma.supplierCreditNote.findMany({
      include: { supplier: true, po: true },
      orderBy: { date: 'desc' }
    })
    return notes.map(cn => ({
      id: cn.id,
      creditNoteNumber: cn.creditNoteNumber,
      supplierId: cn.supplierId,
      supplier: cn.supplier ? { id: cn.supplier.id, name: cn.supplier.name } : undefined,
      poId: cn.poId,
      po: cn.po ? { id: cn.po.id, poNumber: cn.po.poNumber } : undefined,
      amount: Number(cn.amount),
      date: cn.date,
      reason: cn.reason,
      materialId: cn.materialId,
      quantity: cn.quantity,
      notes: cn.notes,
      createdAt: cn.createdAt
    }))
  },

  // Supplier Invoices
  async getAllSupplierInvoices(status?: string): Promise<SupplierInvoice[]> {
    const where = status ? { status: status as SupplierInvoiceStatus } : {}
    const invoices = await prisma.supplierInvoice.findMany({
      where,
      include: {
        po: true,
        supplier: true,
        payments: true
      },
      orderBy: { date: 'desc' }
    })
    return invoices.map(inv => ({
      id: inv.id,
      poId: inv.poId,
      purchaseOrder: inv.po ? {
        id: inv.po.id,
        poNumber: inv.po.poNumber,
        supplier: inv.po.supplier,
        status: inv.po.status,
        totalAmount: Number(inv.po.totalAmount),
        createdAt: inv.po.createdAt,
        updatedAt: inv.po.updatedAt
      } : undefined,
      supplierId: inv.supplierId,
      supplier: inv.supplier ? {
        id: inv.supplier.id,
        name: inv.supplier.name
      } : undefined,
      invoiceNumber: inv.invoiceNumber,
      date: inv.date,
      amount: Number(inv.amount),
      status: inv.status,
      amountPaid: Number(inv.amountPaid),
      createdAt: inv.createdAt,
      payments: inv.payments?.map((p: any) => ({
        id: p.id,
        supplierInvoiceId: p.supplierInvoiceId,
        amount: Number(p.amount),
        date: p.date,
        reference: p.reference || undefined,
        notes: p.notes || undefined,
        paymentMethod: p.paymentMethod || 'Cash',
        createdAt: p.createdAt
      })) || []
    }))
  },

  async getSupplierInvoiceById(id: string): Promise<SupplierInvoice> {
    const inv = await prisma.supplierInvoice.findUnique({
      where: { id },
      include: {
        po: true,
        supplier: true,
        payments: true
      }
    })
    if (!inv) throw new AppError(404, 'NOT_FOUND', 'Supplier invoice not found')
    const all = await this.getAllSupplierInvoices()
    const found = all.find(i => i.id === id)
    if (!found) throw new AppError(404, 'NOT_FOUND', 'Supplier invoice not found')
    return found
  },

  async createSupplierInvoice(poId: string, date: string | Date, amount: number, invoiceNumber?: string): Promise<SupplierInvoice> {
    const po = await procurementRepository.findPOById(poId)
    if (!po) throw new AppError(404, 'NOT_FOUND', 'Purchase order not found')
    if (po.status !== 'RECEIVED') throw new AppError(400, 'INVALID_OPERATION', 'Purchase order must be received before creating a supplier invoice')

    logger.info({ poId, amount }, 'Creating supplier invoice')

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await prisma.$transaction(async (tx) => {
          return createInvoiceInTx(
            tx, poId, po.supplier, po.items || [],
            amount, date, invoiceNumber
          )
        })
      } catch (error: any) {
        if (error?.code === 'P2002' && attempt < 3) {
          logger.warn({ attempt }, 'Supplier invoice number collision, retrying...')
          continue
        }
        throw error
      }
    }
    throw new AppError(500, 'INVOICE_CREATION_FAILED', 'Failed to create supplier invoice after multiple attempts')
  },

  async addPayment(supplierInvoiceId: string, amount: number, date: string | Date, paymentMethod: 'Cash' | 'Bank Transfer', reference?: string, notes?: string, bankAccountId?: string): Promise<PaymentMade> {
    const payJeDateStr = typeof date === 'string' ? date : date instanceof Date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : undefined

    const result = await prisma.$transaction(async (tx) => {
      const inv = await tx.supplierInvoice.findUnique({
        where: { id: supplierInvoiceId },
        include: { po: true, supplier: true }
      })
      if (!inv) throw new AppError(404, 'NOT_FOUND', 'Supplier invoice not found')

      const remainingBalance = Number(inv.amount) - Number(inv.amountPaid)
      if (amount > remainingBalance) {
        throw new AppError(400, 'INVALID_AMOUNT', `Payment N${amount} exceeds remaining balance N${remainingBalance}`)
      }

      const payment = await tx.paymentMade.create({
        data: {
          supplierInvoiceId,
          amount,
          date: typeof date === 'string' ? dateFromInput(date) : date,
          reference,
          notes,
          paymentMethod,
          tenantId: requireTenantId()
        }
      })

      // Atomic increment — prevents lost payments from concurrent writes
      const updated = await tx.supplierInvoice.update({
        where: { id: supplierInvoiceId },
        data: { amountPaid: { increment: amount } }
      })

      const newAmountPaid = Number(updated.amountPaid)
      const newStatus = newAmountPaid >= Number(updated.amount) ? 'PAID' : 'PARTIAL'
      await tx.supplierInvoice.update({
        where: { id: supplierInvoiceId },
        data: { status: newStatus }
      })

      const apAccountId = await financeService.getAccountIdByCode('2000')
      let cashAccountId: string
      if (bankAccountId) {
        cashAccountId = bankAccountId
      } else {
        const cashAccountCode = paymentMethod === 'Cash' ? '1000' : '1100'
        cashAccountId = await financeService.getAccountIdByCode(cashAccountCode)
      }

      await financeService.postJournalEntry({
        description: `Payment for ${inv.invoiceNumber} - ${inv.po?.supplier || ''}`,
        sourceModule: 'PROCUREMENT',
        sourceId: inv.id,
        reference: reference || inv.invoiceNumber,
        date: payJeDateStr,
        lines: [
          { accountId: apAccountId, debit: amount, credit: 0, memo: `Payment to supplier ${inv.invoiceNumber}` },
          { accountId: cashAccountId, debit: 0, credit: amount, memo: paymentMethod === 'Cash' ? 'Cash payment' : 'Bank transfer' }
        ]
      }, tx)

      return payment
    })

    return {
      id: result.id,
      supplierInvoiceId: result.supplierInvoiceId,
      amount: Number(result.amount),
      date: result.date,
      reference: result.reference || undefined,
      notes: result.notes || undefined,
      paymentMethod: (result.paymentMethod || 'Cash') as 'Cash' | 'Bank Transfer',
      createdAt: result.createdAt
    }
  }
}
