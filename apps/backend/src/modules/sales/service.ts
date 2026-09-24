import { Prisma } from '@prisma/client'
import { prisma } from '../../database'
import { AppError } from '../../middleware/errorHandler'
import { requireTenantId } from '../../middleware/tenant'
import { createChildLogger } from '../../logger'
import { financeService } from '../finance/service'
import { auditService } from '../audit'
import { dateFromInput } from '../../utils/dates'
import { decomposeInclusive } from '../../lib/vat-utils'
import { CreateSaleInput, DeliverSaleInput, RecordPaymentInput, RecordDepositInput, CustomerCreditNoteInput } from './validation'
import { SaleLineAllocation } from './types'

const logger = createChildLogger('sales:service')

const REVENUE_BY_CATEGORY: Record<string, string> = { BOTTLED: '4001', SACHET: '4002', JAR: '4003' }
const FG_BY_CATEGORY: Record<string, string> = { BOTTLED: '1325', SACHET: '1326', JAR: '1327' }
const AR_ACCOUNT = '1200'
const VAT_OUTPUT = '2100'
const COGS_ACCOUNT = '5000'
const CASH_ACCOUNT = '1000'
const BANK_ACCOUNT = '1100'
const ADVANCE_ACCOUNT = '2250'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const saleDetailInclude = {
  customer: true,
  lines: {
    include: { variant: { include: { product: true } } },
    orderBy: { id: 'asc' as const }
  },
  invoices: { include: { payments: true }, orderBy: { issuedAt: 'desc' as const } },
  paymentTransactions: { include: { receipts: true }, orderBy: { receivedAt: 'desc' as const } }
}

async function nextNumber(db: any, model: 'sale' | 'invoice' | 'receipt'): Promise<string> {
  const year = new Date().getFullYear()
  const cfg = {
    sale: { delegate: db.sale, field: 'saleNumber', prefix: `SAL-${year}-` },
    invoice: { delegate: db.invoice, field: 'invoiceNumber', prefix: `INV-${year}-` },
    receipt: { delegate: db.receipt, field: 'receiptNumber', prefix: `REC-${year}-` }
  }[model]
  const last = await cfg.delegate.findFirst({
    where: { [cfg.field]: { startsWith: cfg.prefix } },
    orderBy: { [cfg.field]: 'desc' },
    select: { [cfg.field]: true }
  })
  const lastNum = last ? parseInt(String(last[cfg.field]).replace(cfg.prefix, '') || '0', 10) : 0
  return `${cfg.prefix}${String(lastNum + 1).padStart(4, '0')}`
}

async function getVatRate(db: any): Promise<number> {
  const settings = await db.settings.findFirst({ select: { vatRate: true } })
  return Number(settings?.vatRate ?? 7.5)
}

async function getAccountId(db: any, code: string): Promise<string> {
  const account = await db.account.findFirst({ where: { code, isActive: true }, select: { id: true } })
  if (!account) {
    throw new AppError(400, 'SETUP_ACCOUNT_MISSING', `Required account ${code} is missing. Contact an administrator.`)
  }
  return account.id
}

interface PricedLine {
  variantId: string
  qty: number
  unitPrice: number
  subtotal: number
  vatAmount: number
  category: string
}

async function priceLines(
  db: any,
  lines: { variantId: string; qty: number; unitPrice?: number; isRefill?: boolean }[],
  canDiscount: boolean,
  vatRate: number,
  customerDiscountPercent: number = 0
): Promise<PricedLine[]> {
  const out: PricedLine[] = []
  for (const line of lines) {
    const variant = await db.productVariant.findUnique({
      where: { id: line.variantId },
      include: { product: true }
    })
    if (!variant) throw new AppError(404, 'NOT_FOUND', `Variant ${line.variantId} not found`)
    if (!variant.isActive) throw new AppError(400, 'INACTIVE_VARIANT', `Variant '${variant.label}' is archived`)
    const isRefill = line.isRefill && variant.product.category === 'JAR' && variant.refillPrice !== null
    const basePrice = isRefill ? Number(variant.refillPrice) : Number(variant.pricePerUnit)
    const effectivePrice = round2(basePrice * (1 - customerDiscountPercent / 100))
    const unitPrice = line.unitPrice ?? effectivePrice
    if (Math.abs(unitPrice - effectivePrice) > 0.005 && !canDiscount) {
      const fmt = (n: number) => `₦${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
      const priceLabel = customerDiscountPercent > 0
        ? `the customer's ${customerDiscountPercent}% discounted price (${fmt(effectivePrice)})`
        : `the list price (${fmt(effectivePrice)})`
      throw new AppError(403, 'DISCOUNT_DENIED', `Price for '${variant.label}' differs from ${priceLabel} — requires the sales:discount permission`)
    }
    const subtotal = round2(line.qty * unitPrice)
    const { vat } = decomposeInclusive(subtotal, vatRate)
    out.push({
      variantId: variant.id,
      qty: line.qty,
      unitPrice: round2(unitPrice),
      subtotal,
      vatAmount: round2(vat),
      category: variant.product.category
    })
  }
  return out
}

async function lockFgRows(tx: any, variantIds: string[]) {
  if (variantIds.length === 0) return
  await tx.$queryRaw`SELECT "id" FROM "FinishedGoodStock" WHERE "variantId" IN (${Prisma.join(
    variantIds
  )}) AND "tenantId" = ${requireTenantId()} FOR UPDATE`
}

async function availableAdvance(tx: any, customerId: string): Promise<number> {
  const standaloneDeposits = await tx.paymentTransaction.aggregate({
    where: { customerId, transactionType: 'DEPOSIT', saleId: null },
    _sum: { amount: true }
  })
  const openingDeposits = await tx.guideAngelOpeningBalance.aggregate({
    where: { customerId, type: 'CUSTOMER_DEPOSIT' },
    _sum: { amount: true }
  })
  const appliedOnInvoices = await tx.invoice.aggregate({
    where: { customerId },
    _sum: { depositApplied: true }
  })
  return Number(standaloneDeposits._sum.amount || 0)
    + Number(openingDeposits._sum.amount || 0)
    - Number(appliedOnInvoices._sum.depositApplied || 0)
}

function dateStartOfDay(dateStr: string): Date {
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0); return d
}
function dateEndOfDay(dateStr: string): Date {
  const d = new Date(dateStr); d.setHours(23, 59, 59, 999); return d
}

export const salesService = {
  async list(status?: string, customerId?: string) {
    return prisma.sale.findMany({
      where: {
        ...(status ? { status: status as any } : {}),
        ...(customerId ? { customerId } : {})
      },
      include: saleDetailInclude,
      orderBy: [{ createdAt: 'desc' }, { saleNumber: 'desc' }],
      take: 500
    })
  },

  async get(id: string) {
    const sale = await prisma.sale.findUnique({ where: { id }, include: saleDetailInclude })
    if (!sale) throw new AppError(404, 'NOT_FOUND', 'Sale not found')
    return sale
  },

  async create(input: CreateSaleInput, opts: { userId?: string; canDiscount: boolean }) {
    const tenantId = requireTenantId()
    const customer = await prisma.customer.findUnique({ where: { id: input.customerId } })
    if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found')
    if (!customer.isActive) throw new AppError(400, 'INACTIVE_CUSTOMER', 'Customer is deactivated')

    const vatRate = await getVatRate(prisma)
    const customerDiscount = Number(customer.discountPercent) || 0
    const priced = await priceLines(prisma, input.lines, opts.canDiscount, vatRate, customerDiscount)
    const totalAmount = round2(priced.reduce((s, l) => s + l.subtotal, 0))

    // Determine sale type: REFILL if any jar line is a refill; else OUTRIGHT.
    const saleType = input.saleType || (input.lines.some(l => l.isRefill) ? 'REFILL' : 'OUTRIGHT') as any

    const payload = (saleNumber: string) => ({
      saleNumber,
      customerId: customer.id,
      status: 'DRAFT' as const,
      saleType,
      emptyBrought: input.emptyBrought || 0,
      totalAmount,
      notes: input.notes || null,
      tenantId
    })

    // Map input isRefill flags for line creation.
    const inputByVariant = new Map(input.lines.map(l => [l.variantId, l.isRefill || false]))

    try {
      return await prisma.$transaction(async (tx) => {
        const saleNumber = await nextNumber(tx, 'sale')
        try {
          const sale = await tx.sale.create({ data: payload(saleNumber) })
          await tx.saleLine.createMany({
            data: priced.map(l => ({
              saleId: sale.id,
              variantId: l.variantId,
              qty: l.qty,
              unitPrice: l.unitPrice,
              subtotal: l.subtotal,
              vatAmount: l.vatAmount,
              isRefill: inputByVariant.get(l.variantId) || false,
              tenantId
            }))
          })
          return tx.sale.findUniqueOrThrow({ where: { id: sale.id }, include: saleDetailInclude })
        } catch (err) {
          if ((err as any)?.code !== 'P2002') throw err
          const retryNumber = await nextNumber(tx, 'sale')
          logger.warn({ retryNumber }, 'Sale number collision, regenerated')
          const sale = await tx.sale.create({ data: payload(retryNumber) })
          await tx.saleLine.createMany({
            data: priced.map(l => ({
              saleId: sale.id,
              variantId: l.variantId,
              qty: l.qty,
              unitPrice: l.unitPrice,
              subtotal: l.subtotal,
              vatAmount: l.vatAmount,
              isRefill: inputByVariant.get(l.variantId) || false,
              tenantId
            }))
          })
          return tx.sale.findUniqueOrThrow({ where: { id: sale.id }, include: saleDetailInclude })
        }
      })
    } catch (err) {
      if ((err as any)?.code === 'P2002') throw new AppError(409, 'DUPLICATE', 'Sale number collision, please retry')
      throw err
    }
  },

  async updateLinePrice(saleId: string, lineId: string, unitPrice: number, canDiscount: boolean) {
    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: { lines: { include: { variant: true } }, customer: true }
    })
    if (!sale) throw new AppError(404, 'NOT_FOUND', 'Sale not found')
    if (sale.status !== 'DRAFT') throw new AppError(400, 'SALE_STATUS', 'Prices can only change on DRAFT sales')
    const line = sale.lines.find(l => l.id === lineId)
    if (!line) throw new AppError(404, 'NOT_FOUND', 'Sale line not found')

    const listPrice = Number((line.variant as any).pricePerUnit)
    const customerDiscount = Number((sale.customer as any)?.discountPercent) || 0
    const effectivePrice = round2(listPrice * (1 - customerDiscount / 100))
    if (Math.abs(unitPrice - effectivePrice) > 0.005 && !canDiscount) {
      const fmt = (n: number) => `₦${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
      const priceLabel = customerDiscount > 0
        ? `the customer's ${customerDiscount}% discounted price (${fmt(effectivePrice)})`
        : `the list price (${fmt(effectivePrice)})`
      throw new AppError(403, 'DISCOUNT_DENIED', `Price differs from ${priceLabel} — requires the sales:discount permission`)
    }
    const vatRate = await getVatRate(prisma)
    const subtotal = round2(line.qty * round2(unitPrice))
    const { vat } = decomposeInclusive(subtotal, vatRate)

    await prisma.saleLine.update({
      where: { id: line.id },
      data: { unitPrice: round2(unitPrice), subtotal, vatAmount: round2(vat) }
    })
    const lines = await prisma.saleLine.findMany({ where: { saleId } })
    const totalAmount = round2(lines.reduce((s, l) => s + Number(l.subtotal), 0))
    return prisma.sale.update({
      where: { id: saleId },
      data: { totalAmount },
      include: saleDetailInclude
    })
  },

  async confirm(id: string, userId?: string) {
    return prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id },
        include: { lines: { include: { variant: true } } }
      })
      if (!sale) throw new AppError(404, 'NOT_FOUND', 'Sale not found')
      if (sale.status === 'CONFIRMED') {
        return { alreadyConfirmed: true, sale: await tx.sale.findUnique({ where: { id }, include: saleDetailInclude }) }
      }
      if (sale.status !== 'DRAFT') {
        throw new AppError(400, 'SALE_STATUS', `Only DRAFT sales can be confirmed (current: ${sale.status})`)
      }

      // Row-lock FG batches for every variant on the sale (concurrent POS safety).
      await lockFgRows(tx, [...new Set(sale.lines.map(l => l.variantId))])

      for (const line of sale.lines) {
        let remaining = line.qty
        let costAccum = 0
        const allocation: SaleLineAllocation[] = []
        const batches = await tx.finishedGoodStock.findMany({
          where: { variantId: line.variantId, location: 'FG_STORE', quantity: { gt: 0 } },
          orderBy: { createdAt: 'asc' }
        })
        const available = batches.reduce((s, b) => s + b.quantity, 0)
        if (available < remaining) {
          const label = (line.variant as any).label
          throw new AppError(
            409,
            'INSUFFICIENT_FG',
            `Insufficient FG for '${label}': needs ${remaining} packs, has ${available}`
          )
        }
        for (const batch of batches) {
          if (remaining <= 0) break
          const take = Math.min(batch.quantity, remaining)
          await tx.finishedGoodStock.update({
            where: { id: batch.id },
            data: { quantity: { decrement: take } }
          })
          costAccum += take * Number(batch.unitCost)
          allocation.push({ stockId: batch.id, batchNumber: batch.batchNumber, qty: take })
          remaining -= take
        }
        const unitCost = line.qty > 0 ? round2(costAccum / line.qty) : 0
        await tx.saleLine.update({
          where: { id: line.id },
          data: { unitCost, allocation: allocation as any }
        })
      }

      const confirmed = await tx.sale.update({
        where: { id },
        data: { status: 'CONFIRMED' },
        include: saleDetailInclude
      })

      await auditService.record({
        userId,
        action: 'sale.confirm',
        entityType: 'Sale',
        entityId: id,
        description: `Confirmed sale ${sale.saleNumber} (FG allocated)`,
        metadata: { saleNumber: sale.saleNumber }
      })
      return { alreadyConfirmed: false, sale: confirmed }
    })
  },

  async deliver(id: string, input: DeliverSaleInput, opts: { userId?: string }) {
    return prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id },
        include: {
          customer: true,
          lines: { include: { variant: { include: { product: true, jarMaterial: true } } } }
        }
      })
      if (!sale) throw new AppError(404, 'NOT_FOUND', 'Sale not found')
      if (sale.status !== 'CONFIRMED') {
        throw new AppError(400, 'SALE_STATUS', `Only CONFIRMED sales can be delivered (current: ${sale.status})`)
      }
      for (const line of sale.lines) {
        if (line.unitCost === null || line.unitCost === undefined) {
          throw new AppError(400, 'SALE_NOT_ALLOCATED', 'Sale lines have no captured cost. Confirm the sale first.')
        }
      }

      // --- Jar balance + empty jar stock return.
      const emptyBrought = (sale as any).emptyBrought || 0
      const refillLines = sale.lines.filter(l => (l as any).isRefill)
      const totalRefillQty = refillLines.reduce((s, l) => s + l.qty, 0)

      logger.info({ saleId: sale.id, saleNumber: sale.saleNumber, emptyBrought, totalRefillQty, saleType: sale.saleType, status: sale.status }, 'Deliver: jar balance check')

      if (totalRefillQty > 0 || emptyBrought > 0) {
        // jarBalance = currentBalance + emptiesBrought - refillsGiven
        const balanceChange = emptyBrought - totalRefillQty
        await tx.customer.update({
          where: { id: sale.customerId },
          data: { jarBalance: { increment: balanceChange } }
        })
        logger.info({ customerId: sale.customerId, emptyBrought, totalRefillQty, balanceChange }, 'Jar balance updated on delivery')
      }

      if (emptyBrought > 0) {
        // Returned empties go back into raw material stock.
        // Use jarMaterialId from the first refill line's variant.
        const firstRefillLine = refillLines[0]
        const jarMaterial = firstRefillLine ? (firstRefillLine as any).variant?.jarMaterial : null
        if (!jarMaterial) {
          logger.warn({ saleId: sale.id, saleNumber: sale.saleNumber }, 'JAR RETURN skipped: no jarMaterial linked to variant')
        } else {
          const stock = await tx.stock.findFirst({ where: { materialId: jarMaterial.id, location: 'MAIN', tenantId: requireTenantId() } })
          if (!stock) {
            logger.warn({ saleId: sale.id, jarMaterialId: jarMaterial.id, jarCode: jarMaterial.code }, 'JAR RETURN skipped: no MAIN stock for jar material')
          } else {
            await tx.stockMovement.create({
              data: {
                materialId: jarMaterial.id,
                stockId: stock.id,
                type: 'RETURN' as any,
                quantity: emptyBrought,
                reference: sale.saleNumber,
                notes: `Empty jars returned on delivery of ${sale.saleNumber}`,
                tenantId: requireTenantId()
              }
            })
            await tx.stock.update({ where: { id: stock.id }, data: { quantity: { increment: emptyBrought } } })
            logger.info({ materialId: jarMaterial.id, jarCode: jarMaterial.code, qty: emptyBrought, saleNumber: sale.saleNumber, stockId: stock.id }, 'JAR RETURN stock movement recorded on delivery')
          }
        }
      } else {
        logger.info({ saleId: sale.id, saleNumber: sale.saleNumber, emptyBrought }, 'JAR RETURN skipped: emptyBrought is 0')
      }

      const journalEntryIds: string[] = []

      // --- Revenue JE: Dr 1200 AR / Cr 400x ex-VAT + Cr 2100 VAT (per category).
      const byCategory = new Map<string, { exclusive: number; vat: number }>()
      for (const line of sale.lines) {
        const subtotal = Number(line.subtotal)
        const vat = Number(line.vatAmount)
        const bucket = byCategory.get((line.variant as any).product.category) || { exclusive: 0, vat: 0 }
        bucket.exclusive += subtotal - vat
        bucket.vat += vat
        byCategory.set((line.variant as any).product.category, bucket)
      }
      const revenueLines: { accountId: string; debit: number; credit: number; memo: string }[] = [
        {
          accountId: await getAccountId(tx, AR_ACCOUNT),
          debit: round2(Number(sale.totalAmount)),
          credit: 0,
          memo: `Receivable for sale ${sale.saleNumber}`
        }
      ]
      for (const [category, sums] of byCategory) {
        const exclusive = round2(sums.exclusive)
        const vat = round2(sums.vat)
        if (exclusive > 0) {
          revenueLines.push({
            accountId: await getAccountId(tx, REVENUE_BY_CATEGORY[category] || '4001'),
            debit: 0,
            credit: exclusive,
            memo: `Revenue for sale ${sale.saleNumber}`
          })
        }
        if (vat > 0) {
          revenueLines.push({
            accountId: await getAccountId(tx, VAT_OUTPUT),
            debit: 0,
            credit: vat,
            memo: `VAT output for sale ${sale.saleNumber}`
          })
        }
      }
      const revenueJe = await financeService.postJournalEntry(
        {
          description: `Sale ${sale.saleNumber} delivered`,
          sourceModule: 'SALES',
          sourceId: sale.id,
          reference: sale.saleNumber,
          postedById: opts.userId,
          date: input.date,
          lines: revenueLines
        },
        tx
      )
      journalEntryIds.push(revenueJe.id)

      // --- COGS JE: Dr 5000 / Cr 132x FG at captured unit cost (per category).
      const cogsByAccount = new Map<string, number>()
      for (const line of sale.lines) {
        const code = FG_BY_CATEGORY[(line.variant as any).product.category] || '1325'
        cogsByAccount.set(code, (cogsByAccount.get(code) || 0) + line.qty * Number(line.unitCost))
      }
      const cogsTotal = round2([...cogsByAccount.values()].reduce((s, v) => s + v, 0))
      const cogsLines: { accountId: string; debit: number; credit: number; memo: string }[] = [
        {
          accountId: await getAccountId(tx, COGS_ACCOUNT),
          debit: cogsTotal,
          credit: 0,
          memo: `COGS for sale ${sale.saleNumber}`
        }
      ]
      for (const [code, amount] of cogsByAccount) {
        const rounded = round2(amount)
        if (rounded > 0) {
          cogsLines.push({
            accountId: await getAccountId(tx, code),
            debit: 0,
            credit: rounded,
            memo: `FG relief for sale ${sale.saleNumber}`
          })
        }
      }
      const cogsJe = await financeService.postJournalEntry(
        {
          description: `COGS for sale ${sale.saleNumber}`,
          sourceModule: 'SALES',
          sourceId: sale.id,
          reference: sale.saleNumber,
          postedById: opts.userId,
          date: input.date,
          lines: cogsLines
        },
        tx
      )
      journalEntryIds.push(cogsJe.id)

      // --- Invoice (one per sale).
      const totalQty = sale.lines.reduce((s, l) => s + l.qty, 0)
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber: await nextNumber(tx, 'invoice'),
          saleId: sale.id,
          customerId: sale.customerId,
          quantityDelivered: totalQty,
          unitPrice: 0,
          packingBagsUnitPrice: 0,
          packingBagsSubtotal: 0,
          subtotal: round2(Number(sale.totalAmount) - sale.lines.reduce((s, l) => s + Number(l.vatAmount), 0)),
          vatAmount: round2(sale.lines.reduce((s, l) => s + Number(l.vatAmount), 0)),
          totalAmount: round2(Number(sale.totalAmount)),
          balanceDue: round2(Number(sale.totalAmount)),
          status: 'ISSUED',
          issuedAt: new Date(),
          dueDate: (() => {
            const d = new Date()
            d.setDate(d.getDate() + ((sale.customer as any)?.paymentTermsDays || 0))
            return d
          })(),
          tenantId: requireTenantId()
        }
      })

      // --- Auto-apply available customer deposits (standalone + GuideAngel opening).
      let balanceDue = round2(Number(sale.totalAmount))
      let advanceApplied = 0
      const available = await availableAdvance(tx, sale.customerId)
      if (available > 0.005 && balanceDue > 0.005) {
        advanceApplied = round2(Math.min(available, balanceDue))
        balanceDue = round2(balanceDue - advanceApplied)

        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            depositApplied: round2(Number(invoice.depositApplied) + advanceApplied),
            amountPaid: round2(Number(invoice.amountPaid) + advanceApplied),
            balanceDue,
            status: balanceDue <= 0.005 ? 'PAID' : 'PARTIAL',
            ...(balanceDue <= 0.005 ? { paidAt: new Date() } : {})
          }
        })

        const advanceAccountId = await getAccountId(tx, ADVANCE_ACCOUNT)
        const arAccountId = await getAccountId(tx, AR_ACCOUNT)
        await financeService.postJournalEntry(
          {
            description: `Deposit applied — ${(invoice as any).invoiceNumber}`,
            sourceModule: 'SALES',
            sourceId: sale.id,
            reference: (invoice as any).invoiceNumber,
            postedById: opts.userId,
            date: input.date,
            lines: [
              { accountId: advanceAccountId, debit: advanceApplied, credit: 0, memo: 'Customer deposit applied' },
              { accountId: arAccountId, debit: 0, credit: advanceApplied, memo: `Applied to ${(invoice as any).invoiceNumber}` }
            ]
          },
          tx
        )
      }

      let delivered = await tx.sale.update({
        where: { id },
        data: { status: balanceDue <= 0.005 ? 'COMPLETED' : 'DELIVERED', notes: input.notes ?? sale.notes },
        include: saleDetailInclude
      })

      // --- Payment leg (cash/bank) — the full tendered amount flows into
      // recordPaymentTx, which fills this invoice first then cascades any
      // excess FIFO to the customer's other debts (Flexo waterfall).
      let payment: unknown = undefined
      if (input.payment && balanceDue > 0.005) {
        const requestedAmount = input.payment.amount ?? balanceDue
        const result = await recordPaymentTx(tx, delivered.id, {
          amount: requestedAmount,
          method: input.payment.method,
          date: input.date,
          reference: input.payment.reference,
          bankAccountId: input.payment.bankAccountId
        }, opts.userId)
        payment = { ...result, invoiceId: invoice.id }
        if (result.saleCompleted) {
          delivered = (await tx.sale.findUnique({ where: { id }, include: saleDetailInclude })) as any
        }
      }

      await auditService.record({
        userId: opts.userId,
        action: 'sale.deliver',
        entityType: 'Sale',
        entityId: id,
        description: `Delivered sale ${sale.saleNumber} (invoice ${(invoice as any).invoiceNumber})`,
        metadata: { saleNumber: sale.saleNumber, journalEntryIds }
      })

      return { sale: delivered, invoiceId: invoice.id, invoiceNumber: (invoice as any).invoiceNumber, journalEntryIds, payment, depositApplied: advanceApplied }
    })
  },

  async recordPayment(id: string, input: RecordPaymentInput, userId?: string) {
    return prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({ where: { id } })
      if (!sale) throw new AppError(404, 'NOT_FOUND', 'Sale not found')
      if (sale.status !== 'DELIVERED') {
        throw new AppError(400, 'SALE_STATUS', `Payments require a DELIVERED sale (current: ${sale.status})`)
      }
      const result = await recordPaymentTx(tx, id, input, userId)
      await auditService.record({
        userId,
        action: 'sale.payment',
        entityType: 'Sale',
        entityId: id,
        description: `Payment of ${input.amount} on sale ${sale.saleNumber}`,
        metadata: { saleNumber: sale.saleNumber, amount: input.amount }
      })
      return result
    })
  },

  async complete(id: string, userId?: string) {
    const sale = await prisma.sale.findUnique({
      where: { id },
      include: { invoices: true }
    })
    if (!sale) throw new AppError(404, 'NOT_FOUND', 'Sale not found')
    if (sale.status === 'COMPLETED') return this.get(id)
    if (sale.status !== 'DELIVERED') {
      throw new AppError(400, 'SALE_STATUS', `Only DELIVERED sales can complete (current: ${sale.status})`)
    }
    const due = sale.invoices.reduce((s, i) => s + Number(i.balanceDue), 0)
    if (due > 0.005) {
      throw new AppError(400, 'BALANCE_DUE', `Invoice balance of ${round2(due)} is still outstanding`)
    }
    const updated = await prisma.sale.update({
      where: { id },
      data: { status: 'COMPLETED' },
      include: saleDetailInclude
    })
    await auditService.record({
      userId,
      action: 'sale.complete',
      entityType: 'Sale',
      entityId: id,
      description: `Completed sale ${sale.saleNumber}`,
      metadata: { saleNumber: sale.saleNumber }
    })
    return updated
  },

  async cancel(id: string, reason: string | undefined, userId?: string) {
    return prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id },
        include: { lines: true }
      })
      if (!sale) throw new AppError(404, 'NOT_FOUND', 'Sale not found')
      if (sale.status === 'CANCELLED') return tx.sale.findUnique({ where: { id }, include: saleDetailInclude })
      if (sale.status !== 'DRAFT' && sale.status !== 'CONFIRMED') {
        throw new AppError(400, 'SALE_STATUS', `Sale ${sale.saleNumber} cannot be cancelled after delivery (credit note required)`)
      }

      if (sale.status === 'CONFIRMED') {
        // Restore allocated FG from the frozen per-line allocation.
        for (const line of sale.lines) {
          const allocation = (line.allocation as unknown as SaleLineAllocation[] | null) || []
          for (const leg of allocation) {
            if (!leg || leg.qty <= 0) continue
            await tx.finishedGoodStock.upsert({
              where: {
                tenantId_variantId_batchNumber_location: {
                  tenantId: requireTenantId(),
                  variantId: line.variantId,
                  batchNumber: leg.batchNumber,
                  location: 'FG_STORE'
                }
              },
              update: { quantity: { increment: Math.round(leg.qty) } },
              create: {
                variantId: line.variantId,
                batchNumber: leg.batchNumber,
                location: 'FG_STORE',
                quantity: Math.round(leg.qty),
                unitCost: Number(line.unitCost || 0),
                tenantId: requireTenantId()
              }
            })
          }
        }
      }

      const cancelled = await tx.sale.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          notes: reason ? `${sale.notes ? sale.notes + ' | ' : ''}Cancelled: ${reason}` : sale.notes
        },
        include: saleDetailInclude
      })

      await auditService.record({
        userId,
        action: 'sale.cancel',
        entityType: 'Sale',
        entityId: id,
        description: `Cancelled sale ${sale.saleNumber}${reason ? `: ${reason}` : ''}`,
        metadata: { saleNumber: sale.saleNumber }
      })
      return cancelled
    })
  },

  async receiptData(id: string) {
    const sale = await this.get(id)
    const settings = await prisma.settings.findFirst()
    const tenant = await prisma.tenant.findFirst({ select: { name: true } })
    return {
      sale,
      tenantName: tenant?.name || '',
      receipt: {
        companyName: (settings as any)?.receiptCompanyName || tenant?.name || '',
        footer: (settings as any)?.receiptFooter || ''
      },
      invoice: {
        companyName: (settings as any)?.invoiceCompanyName || tenant?.name || '',
        footer: (settings as any)?.invoiceFooter || ''
      }
    }
  },

  async listInvoices(filters?: { status?: string; customerId?: string; dateFrom?: string; dateTo?: string }) {
    const where: any = { saleId: { not: null } }
    if (filters?.status) where.status = filters.status
    if (filters?.customerId) where.customerId = filters.customerId
    if (filters?.dateFrom || filters?.dateTo) {
      where.issuedAt = {}
      if (filters.dateFrom) where.issuedAt.gte = dateStartOfDay(filters.dateFrom)
      if (filters.dateTo) where.issuedAt.lte = dateEndOfDay(filters.dateTo)
    }
    return prisma.invoice.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, code: true } },
        sale: { select: { id: true, saleNumber: true } },
        payments: true
      },
      orderBy: { issuedAt: 'desc' },
      take: 500
    })
  },

  async listPayments(filters?: { customerId?: string; dateFrom?: string; dateTo?: string }) {
    const where: any = {}
    if (filters?.customerId) where.customerId = filters.customerId
    if (filters?.dateFrom || filters?.dateTo) {
      where.receivedAt = {}
      if (filters.dateFrom) where.receivedAt.gte = dateStartOfDay(filters.dateFrom)
      if (filters.dateTo) where.receivedAt.lte = dateEndOfDay(filters.dateTo)
    }
    return prisma.paymentTransaction.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, code: true } },
        sale: { select: { id: true, saleNumber: true } },
        receipts: true
      },
      orderBy: { receivedAt: 'desc' },
      take: 500
    })
  },

  async recordDeposit(input: RecordDepositInput, userId?: string) {
    return prisma.$transaction(async (tx) => {
      const tenantId = requireTenantId()
      const customer = await tx.customer.findUnique({ where: { id: input.customerId } })
      if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found')
      if (!customer.isActive) throw new AppError(400, 'INACTIVE_CUSTOMER', 'Customer is deactivated')
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required')

      const baseRef = input.reference || baseReference('DEP', input.date)

      // A deposit first settles the customer's oldest debts FIFO (Flexo
      // waterfall); only the remainder sits as 2250 advance credit.
      const cascade = await cascadeExcess(tx, input.customerId, round2(input.amount), {
        method: input.method,
        date: input.date,
        baseRef,
        userId,
        tenantId
      })
      const remainder = cascade.leftover

      let debitAccountId: string
      if (input.bankAccountId) {
        const bank = await tx.account.findFirst({ where: { id: input.bankAccountId, isActive: true }, select: { id: true } })
        if (!bank) throw new AppError(404, 'NOT_FOUND', 'Bank account not found')
        debitAccountId = bank.id
      } else {
        debitAccountId = await getAccountId(tx, input.method === 'CASH' ? CASH_ACCOUNT : BANK_ACCOUNT)
      }

      let paymentTx: any = null
      if (remainder > 0.005) {
        paymentTx = await tx.paymentTransaction.create({
          data: {
            customerId: input.customerId,
            transactionType: 'DEPOSIT',
            paymentMethod: input.method,
            amount: remainder,
            referenceNumber: baseRef,
            notes: input.notes || null,
            receivedById: userId,
            tenantId
          }
        })
      }

      const receiptHost = paymentTx
        || (cascade.legs.find(l => l.paymentTransactionId) ? { id: cascade.legs.find(l => l.paymentTransactionId)!.paymentTransactionId } : null)
      let receiptNumber: string | undefined
      if (receiptHost) {
        receiptNumber = await createReceiptFor(tx, receiptHost.id, {
          customerName: customer.name,
          amount: round2(input.amount),
          method: input.method,
          reference: baseRef
        }, userId, tenantId)
      }

      const jeLines: { accountId: string; debit: number; credit: number; memo: string }[] = [
        { accountId: debitAccountId, debit: round2(input.amount), credit: 0, memo: input.method === 'CASH' ? 'Cash received' : 'Bank transfer received' }
      ]
      if (cascade.totalCascaded > 0.005) {
        jeLines.push({ accountId: await getAccountId(tx, AR_ACCOUNT), debit: 0, credit: cascade.totalCascaded, memo: 'Advance applied to arrears' })
      }
      if (remainder > 0.005) {
        jeLines.push({ accountId: await getAccountId(tx, ADVANCE_ACCOUNT), debit: 0, credit: remainder, memo: 'Customer deposit' })
      }
      await financeService.postJournalEntry(
        {
          description: `Deposit from ${customer.name} — ${baseRef}`,
          sourceModule: 'PAYMENT',
          sourceId: paymentTx?.id,
          reference: baseRef,
          postedById: userId,
          date: input.date,
          lines: jeLines
        },
        tx
      )

      await auditService.record({
        userId,
        action: 'sale.deposit',
        entityType: 'PaymentTransaction',
        entityId: paymentTx?.id || receiptHost?.id || input.customerId,
        description: `Deposit of ${input.amount} from ${customer.name}`,
        metadata: { customerId: input.customerId, amount: input.amount, cascadedAmount: cascade.totalCascaded, receivableSettled: cascade.receivableSettled }
      })

      const depositHeld = await availableAdvance(tx, input.customerId)
      return {
        paymentTransactionId: receiptHost?.id || paymentTx?.id,
        receiptNumber,
        depositHeld,
        overpayment: remainder,
        cascadedAmount: cascade.totalCascaded,
        receivableSettled: cascade.receivableSettled
      }
    })
  },

  async createCustomerCreditNote(input: CustomerCreditNoteInput, opts: { userId?: string }) {
    const tenantId = requireTenantId()
    return prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: input.customerId } })
      if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found')
      if (!customer.isActive) throw new AppError(400, 'INACTIVE_CUSTOMER', 'Customer is deactivated')

      if (!input.saleId) throw new AppError(400, 'SALE_REQUIRED', 'Sale is required for a customer return')

      const sale = await tx.sale.findUnique({
        where: { id: input.saleId },
        include: {
          customer: true,
          lines: { include: { variant: { include: { product: true } } } },
          invoices: true
        }
      })
      if (!sale) throw new AppError(404, 'NOT_FOUND', 'Sale not found')
      if (String(sale.customerId) !== String(input.customerId)) {
        throw new AppError(400, 'CUSTOMER_MISMATCH', 'Customer does not match the sale')
      }
      if (!['DELIVERED', 'COMPLETED'].includes(sale.status)) {
        throw new AppError(400, 'SALE_STATUS', `Only DELIVERED or COMPLETED sales can be returned (current: ${sale.status})`)
      }

      const saleLine = sale.lines.find(l => l.variantId === input.variantId)
      if (!saleLine) throw new AppError(404, 'NOT_FOUND', 'Variant not found on this sale')

      console.log(`📝 Creating customer credit note ${sale.saleNumber} (saleId=${sale.id}, variantId=${input.variantId})`)
      console.log(`   - Allocation present: ${Array.isArray(saleLine.allocation) ? (saleLine.allocation as any).length : 0} items`)

      // Enforce qty does not exceed deliverable minus already returned
      const existing = await tx.customerCreditNote.aggregate({
        where: { saleId: input.saleId, variantId: input.variantId } as any,
        _sum: { quantity: true }
      })
      const alreadyReturned = Number(existing._sum.quantity || 0)
      const maxReturnable = saleLine.qty - alreadyReturned
      if (input.quantity > maxReturnable) {
        throw new AppError(400, 'QTY_EXCEEDED', `Cannot return ${input.quantity} packs — only ${maxReturnable} of '${(saleLine.variant as any).label}' remains returnable on ${sale.saleNumber} (already returned ${alreadyReturned} of ${saleLine.qty})`)
      }

      const variant = saleLine.variant as any
      const product = variant.product as any
      const category: string = product.category
      const revenueCode = REVENUE_BY_CATEGORY[category] || '4001'
      const fgCode = FG_BY_CATEGORY[category] || '1325'

      const vatRate = await getVatRate(tx)
      const unitPrice = Number(saleLine.unitPrice)
      const unitCost = Number(saleLine.unitCost || 0)
      const totalInclusive = round2(input.quantity * unitPrice)
      const { exclusive, vat } = decomposeInclusive(totalInclusive, vatRate)
      const exVatAmount = round2(exclusive)
      const vatAmount = round2(vat)

      // Refund account
      let refundAccountId: string
      let refundMethodForJE: string
      if (input.refundMethod === 'CASH') {
        refundAccountId = await getAccountId(tx, CASH_ACCOUNT)
        refundMethodForJE = 'Cash'
      } else if (input.refundMethod === 'BANK') {
        if (input.bankAccountId) {
          const bank = await tx.account.findFirst({ where: { id: input.bankAccountId, isActive: true }, select: { id: true } })
          if (!bank) throw new AppError(404, 'NOT_FOUND', 'Bank account not found')
          refundAccountId = bank.id
        } else {
          refundAccountId = await getAccountId(tx, BANK_ACCOUNT)
        }
        refundMethodForJE = 'Bank'
      } else {
        refundAccountId = await getAccountId(tx, ADVANCE_ACCOUNT)
        refundMethodForJE = 'Credit'
      }

      // Generate CR number
      const year = new Date().getFullYear()
      const prefix = `CR-${year}-`
      const last = await (tx as any).customerCreditNote.findFirst({
        where: { creditNoteNumber: { startsWith: prefix } } as any,
        orderBy: { creditNoteNumber: 'desc' } as any,
        select: { creditNoteNumber: true } as any
      })
      const lastNum = last ? parseInt(String(last.creditNoteNumber).replace(prefix, '') || '0', 10) : 0
      const creditNoteNumber = `${prefix}${String(lastNum + 1).padStart(3, '0')}`

      // Resolve batchNumber from allocation
      let batchNumber: string | null = null
      const allocation = (saleLine.allocation as unknown as SaleLineAllocation[] | null) || []
      let allocationMissing = false
      let allocationReconstructed = false

      if (allocation[0]?.batchNumber) {
        batchNumber = allocation[0].batchNumber
        console.log(`  ✓ Using allocation batch: ${batchNumber}`)
      } else {
        allocationMissing = true
        const candidates = await tx.finishedGoodStock.findMany({
          where: { variantId: input.variantId, tenantId } as any,
          orderBy: { createdAt: 'asc' } as any
        })
        const fgStoreBatches = candidates.filter((s: any) => s.location === 'FG_STORE')
        const eligible =
          fgStoreBatches.find((s: any) => s.createdAt <= sale.createdAt) ||
          fgStoreBatches[0] ||
          candidates[candidates.length - 1]

        if (eligible?.batchNumber) {
          allocationReconstructed = true
          batchNumber = eligible.batchNumber
          console.warn(`⚠️  No allocation for sale ${sale.saleNumber}, reconstructed batch: ${batchNumber}`)
          await tx.saleLine.update({
            where: { id: saleLine.id },
            data: {
              allocation: [{ stockId: eligible.id, batchNumber: eligible.batchNumber, qty: saleLine.qty }] as any
            }
          })
        } else {
          batchNumber = `RET-${year}-${String(lastNum + 1).padStart(4, '0')}`
          console.warn(`⚠️  No allocation or FG stock for sale ${sale.saleNumber}, creating return bucket: ${batchNumber}`)
        }
      }

      const creditNote = await (tx as any).customerCreditNote.create({
        data: {
          creditNoteNumber,
          customerId: input.customerId,
          saleId: input.saleId,
          variantId: input.variantId,
          quantity: input.quantity,
          unitPrice,
          amount: totalInclusive,
          vatAmount,
          exVatAmount,
          reason: input.reason,
          disposition: input.disposition,
          refundMethod: input.refundMethod || 'CREDIT',
          date: dateFromInput(input.date),
          notes: input.notes || null,
          batchNumber,
          createdById: opts.userId || null,
          tenantId
        }
      })

      // --- JE 1: Revenue reversal Dr Rev (exVAT) + Dr VAT / Cr RefundAccount (2250/1000/1100)
      const revenueLines: { accountId: string; debit: number; credit: number; memo: string }[] = []
      if (exVatAmount > 0.005) {
        revenueLines.push({ accountId: await getAccountId(tx, revenueCode), debit: exVatAmount, credit: 0, memo: `Sales return ${creditNoteNumber} — ${variant.label}` })
      }
      if (vatAmount > 0.005) {
        revenueLines.push({ accountId: await getAccountId(tx, VAT_OUTPUT), debit: vatAmount, credit: 0, memo: `VAT reversal ${creditNoteNumber}` })
      }
      revenueLines.push({ accountId: refundAccountId, debit: 0, credit: totalInclusive, memo: `${refundMethodForJE} credit ${creditNoteNumber}` })

      await financeService.postJournalEntry(
        {
          description: `Customer credit note ${creditNoteNumber} — ${customer.name} — ${variant.label} x${input.quantity} — ${input.reason}`,
          sourceModule: 'SALES_RETURN' as any,
          sourceId: creditNote.id,
          reference: creditNoteNumber,
          postedById: opts.userId,
          date: input.date,
          lines: revenueLines
        },
        tx
      )

      // --- JE 2 + Stock: COGS reversal + FG increment
      const cogsAmount = round2(input.quantity * unitCost)
      if (cogsAmount > 0.005) {
        const location = input.disposition === 'RESTOCK' ? 'FG_STORE' : 'FG_DEFECTIVE'
        const fgAccountId = await getAccountId(tx, fgCode)

        // Post COGS JE: Dr FG / Cr COGS (sales return restores inventory)
        await financeService.postJournalEntry(
          {
            description: `COGS reversal — ${creditNoteNumber} — ${variant.label} x${input.quantity} (${input.disposition})`,
            sourceModule: 'SALES_RETURN' as any,
            sourceId: creditNote.id,
            reference: creditNoteNumber,
            postedById: opts.userId,
            date: input.date,
            lines: [
              { accountId: fgAccountId, debit: cogsAmount, credit: 0, memo: `FG ${location} — ${creditNoteNumber}` },
              { accountId: await getAccountId(tx, COGS_ACCOUNT), debit: 0, credit: cogsAmount, memo: `COGS reversal ${creditNoteNumber}` }
            ]
          },
          tx
        )

        // Increment FinishedGoodStock at the disposition location
        await tx.finishedGoodStock.upsert({
          where: {
            tenantId_variantId_batchNumber_location: {
              tenantId,
              variantId: input.variantId,
              batchNumber: batchNumber!,
              location
            }
          } as any,
          update: { quantity: { increment: input.quantity } },
          create: {
            variantId: input.variantId,
            batchNumber: batchNumber!,
            location,
            quantity: input.quantity,
            unitCost,
            tenantId
          } as any
        })
      }

await auditService.record({
        userId: opts.userId,
        action: 'sale.customer_credit_note',
        entityType: 'CustomerCreditNote',
        entityId: creditNote.id,
        description: `Customer credit note ${creditNoteNumber} — ${customer.name} — ${variant.label} x${input.quantity} — ${input.disposition}`,
        metadata: {
          creditNoteNumber,
          saleNumber: sale.saleNumber,
          variantLabel: variant.label,
          quantity: input.quantity,
          amount: totalInclusive,
          disposition: input.disposition,
          refundMethod: input.refundMethod,
          batchNumber,
          allocationMissing,
          allocationReconstructed
        }
      })

      console.log(`✅ Customer credit note ${creditNoteNumber} created`)
      if (allocationMissing) {
        console.warn(`⚠️  Used ${allocationReconstructed ? 'reconstructed' : 'fallback'} batch number: ${batchNumber}`)
      }

      return creditNote
    })
  },

  async getCustomerCreditNotes(filters?: { customerId?: string; saleId?: string; dateFrom?: string; dateTo?: string }) {
    const where: any = {}
    if (filters?.customerId) where.customerId = filters.customerId
    if (filters?.saleId) where.saleId = filters.saleId
    if (filters?.dateFrom || filters?.dateTo) {
      where.date = {}
      if (filters.dateFrom) where.date.gte = dateStartOfDay(filters.dateFrom)
      if (filters.dateTo) where.date.lte = dateEndOfDay(filters.dateTo)
    }
    return (prisma as any).customerCreditNote.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, code: true } },
        sale: { select: { id: true, saleNumber: true } },
        variant: { select: { id: true, label: true, product: { select: { name: true, category: true } } } }
      },
      orderBy: { date: 'desc' },
      take: 500
    })
  },

  async getCustomerCreditNoteById(id: string) {
    const note = await (prisma as any).customerCreditNote.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, code: true } },
        sale: { select: { id: true, saleNumber: true } },
        variant: { select: { id: true, label: true, product: { select: { name: true, category: true } } } }
      }
    })
    if (!note) throw new AppError(404, 'NOT_FOUND', 'Credit note not found')
    return note
  }
}

function baseReference(prefix: string, dateStr?: string): string {
  const d = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr.replace(/-/g, '') : (() => {
    const n = new Date()
    return `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, '0')}${String(n.getDate()).padStart(2, '0')}`
  })()
  const suffix = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `${prefix}-${d}-${suffix}`
}

interface CascadeLeg {
  saleId: string | null
  invoiceId: string | null
  amount: number
  paymentTransactionId?: string
}

// Settle `remaining` FIFO across the customer's other debts (oldest first):
// GuideAngel opening receivables + other unpaid invoices (excluding `excludeInvoiceId`).
// Updates invoices/receivables in place and books a PAYMENT PaymentTransaction
// (+ PaymentReceived for compat) per settled invoice leg. Returns what's left.
async function cascadeExcess(
  tx: any,
  customerId: string,
  remaining: number,
  opts: {
    excludeInvoiceId?: string
    method: 'CASH' | 'BANK_TRANSFER'
    date?: string
    baseRef: string
    userId?: string
    tenantId: string
  }
): Promise<{ leftover: number; totalCascaded: number; receivableSettled: number; legs: CascadeLeg[] }> {
  let totalCascaded = 0
  let receivableSettled = 0
  const legs: CascadeLeg[] = []
  if (remaining <= 0.005) return { leftover: remaining, totalCascaded, receivableSettled, legs }

  const openingReceivables = await tx.guideAngelOpeningBalance.findMany({
    where: { customerId, type: 'CUSTOMER_RECEIVABLE' },
    orderBy: { date: 'asc' }
  })
  const receivableDebts: { kind: 'RECEIVABLE'; id: string; date: Date; remaining: number }[] = []
  for (const entry of openingReceivables) {
    const left = Number(entry.amount) - Number(entry.settledAmount)
    if (left > 0.005) receivableDebts.push({ kind: 'RECEIVABLE', id: entry.id, date: entry.date, remaining: left })
  }

  const otherInvoices = await tx.invoice.findMany({
    where: {
      customerId,
      balanceDue: { gt: 0 },
      status: { not: 'CANCELLED' },
      ...(opts.excludeInvoiceId ? { id: { not: opts.excludeInvoiceId } } : {})
    },
    orderBy: { issuedAt: 'asc' },
    include: { sale: { select: { id: true, saleNumber: true, status: true } } }
  })
  const invoiceDebts: { kind: 'INVOICE'; id: string; date: Date; remaining: number; inv: any }[] = []
  for (const inv of otherInvoices) {
    const left = Number(inv.balanceDue)
    if (left > 0.005) {
      invoiceDebts.push({
        kind: 'INVOICE',
        id: inv.id,
        date: (inv as any).issuedAt || (inv as any).createdAt,
        remaining: left,
        inv
      })
    }
  }

  const allDebts = [...receivableDebts, ...invoiceDebts].sort((a, b) => a.date.getTime() - b.date.getTime())

  const methodLabel = opts.method === 'CASH' ? 'Cash' : 'Bank Transfer'
  let left = remaining
  for (const debt of allDebts) {
    if (left <= 0.005) break
    const apply = round2(Math.min(left, debt.remaining))
    if (apply <= 0.005) continue

    if (debt.kind === 'RECEIVABLE') {
      await tx.guideAngelOpeningBalance.update({
        where: { id: debt.id },
        data: { settledAmount: { increment: apply } }
      })
      receivableSettled = round2(receivableSettled + apply)
      legs.push({ saleId: null, invoiceId: null, amount: apply })
    } else {
      const inv = (debt as { inv: any }).inv
      const newDue = round2(Number(inv.balanceDue) - apply)
      const newPaid = round2(Number(inv.amountPaid) + apply)
      await tx.invoice.update({
        where: { id: debt.id },
        data: {
          amountPaid: newPaid,
          balanceDue: newDue,
          status: newDue <= 0.005 ? 'PAID' : 'PARTIAL',
          ...(newDue <= 0.005 ? { paidAt: dateFromInput(opts.date) } : {})
        }
      })
      // A cascaded sale whose invoice just cleared completes like a direct pay.
      const linkedSale = (inv as any).sale
      if (linkedSale && linkedSale.status === 'DELIVERED' && newDue <= 0.005) {
        await tx.sale.update({ where: { id: linkedSale.id }, data: { status: 'COMPLETED' } })
      }
      const cascadeRef = `OVR-${opts.baseRef}-${legs.length + 1}`
      const cascadeTx = await tx.paymentTransaction.create({
        data: {
          saleId: linkedSale?.id || null,
          customerId,
          transactionType: 'PAYMENT',
          paymentMethod: opts.method,
          amount: apply,
          referenceNumber: cascadeRef,
          notes: `Cascade from ${opts.baseRef}`,
          receivedById: opts.userId,
          tenantId: opts.tenantId
        }
      })
      await tx.paymentReceived.create({
        data: {
          invoiceId: debt.id,
          amount: apply,
          reference: cascadeRef,
          notes: `Cascade from ${opts.baseRef}`,
          paymentMethod: methodLabel,
          tenantId: opts.tenantId
        }
      })
      legs.push({ saleId: linkedSale?.id || null, invoiceId: debt.id, amount: apply, paymentTransactionId: cascadeTx.id })
    }

    totalCascaded = round2(totalCascaded + apply)
    left = round2(left - apply)
  }

  return { leftover: left, totalCascaded, receivableSettled, legs }
}

async function createReceiptFor(
  tx: any,
  paymentTransactionId: string,
  input: { customerName: string; amount: number; method: 'CASH' | 'BANK_TRANSFER'; reference?: string },
  userId: string,
  tenantId: string
): Promise<string | undefined> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = await nextNumber(tx, 'receipt')
    try {
      await tx.receipt.create({
        data: {
          receiptNumber: candidate,
          paymentTransactionId,
          customerName: input.customerName,
          amount: input.amount,
          paymentMethod: input.method === 'CASH' ? 'Cash' : 'Bank Transfer',
          referenceNumber: input.reference || null,
          generatedById: userId,
          tenantId
        }
      })
      return candidate
    } catch (err) {
      if ((err as any)?.code !== 'P2002') throw err
    }
  }
  return undefined
}

async function recordPaymentTx(
  tx: any,
  saleId: string,
  input: { amount: number; method: 'CASH' | 'BANK_TRANSFER'; date?: string; reference?: string; bankAccountId?: string; notes?: string },
  userId?: string
) {
  const tenantId = requireTenantId()
  if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required')
  const sale = await tx.sale.findUnique({
    where: { id: saleId },
    include: { customer: true, invoices: { orderBy: { issuedAt: 'asc' } } }
  })
  if (!sale) throw new AppError(404, 'NOT_FOUND', 'Sale not found')
  const invoice = sale.invoices.find((i: any) => i.status !== 'CANCELLED')
  if (!invoice) throw new AppError(400, 'NO_INVOICE', 'Sale has no open invoice')

  const customerId: string = sale.customerId
  const customerName = (sale.customer as any)?.name || ''
  const baseRef = input.reference || baseReference('PAY', input.date)

  // Step 1 — fill the current invoice first; anything above it is excess.
  const currentDue = Math.max(0, Number(invoice.balanceDue))
  const revenuePortion = round2(Math.min(input.amount, currentDue))
  let excess = round2(input.amount - revenuePortion)

  // Step 2 — cascade excess FIFO across the customer's other debts.
  const cascade = await cascadeExcess(tx, customerId, excess, {
    excludeInvoiceId: invoice.id,
    method: input.method,
    date: input.date,
    baseRef,
    userId,
    tenantId
  })
  excess = cascade.leftover

  let debitAccountId: string
  if (input.bankAccountId) {
    const bank = await tx.account.findFirst({
      where: { id: input.bankAccountId, isActive: true },
      select: { id: true }
    })
    if (!bank) throw new AppError(404, 'NOT_FOUND', 'Bank account not found')
    debitAccountId = bank.id
  } else {
    debitAccountId = await getAccountId(tx, input.method === 'CASH' ? CASH_ACCOUNT : BANK_ACCOUNT)
  }

  // Step 3 — primary row for the current-invoice portion.
  let paymentTx: any = null
  if (revenuePortion > 0.005) {
    paymentTx = await tx.paymentTransaction.create({
      data: {
        saleId: sale.id,
        customerId,
        transactionType: 'PAYMENT',
        paymentMethod: input.method,
        amount: revenuePortion,
        referenceNumber: baseRef,
        notes: input.notes || null,
        receivedById: userId,
        tenantId
      }
    })

    await tx.paymentReceived.create({
      data: {
        invoiceId: invoice.id,
        amount: revenuePortion,
        reference: baseRef,
        notes: input.notes || null,
        paymentMethod: input.method === 'CASH' ? 'Cash' : 'Bank Transfer',
        tenantId
      }
    })
  }

  // Step 4 — whatever is still left becomes a standalone advance deposit (2250).
  let overpaymentDeposit: any = null
  if (excess > 0.005) {
    const depRef = `OVR-${baseRef}`
    overpaymentDeposit = await tx.paymentTransaction.create({
      data: {
        customerId,
        transactionType: 'DEPOSIT',
        paymentMethod: input.method,
        amount: excess,
        referenceNumber: depRef,
        notes: `Overpayment from ${baseRef}`,
        receivedById: userId,
        tenantId
      }
    })
  }

  // Single receipt for the full cash tendered.
  const receiptHost = paymentTx || overpaymentDeposit
    || (cascade.legs.find(l => l.paymentTransactionId) ? { id: cascade.legs.find(l => l.paymentTransactionId)!.paymentTransactionId } : null)
  let receiptNumber: string | undefined
  if (receiptHost) {
    receiptNumber = await createReceiptFor(tx, receiptHost.id, {
      customerName,
      amount: round2(input.amount),
      method: input.method,
      reference: baseRef
    }, userId, tenantId)
  }

  // Step 5 — single balanced JE: Dr Cash/Bank (full) / Cr AR (settled) / Cr 2250 (excess).
  const totalSettled = round2(revenuePortion + cascade.totalCascaded)
  const jeLines: { accountId: string; debit: number; credit: number; memo: string }[] = [
    {
      accountId: debitAccountId,
      debit: round2(input.amount),
      credit: 0,
      memo: input.method === 'CASH' ? 'Cash received' : 'Bank transfer received'
    }
  ]
  if (totalSettled > 0.005) {
    jeLines.push({
      accountId: await getAccountId(tx, AR_ACCOUNT),
      debit: 0,
      credit: totalSettled,
      memo: `Customer payment for sale ${sale.saleNumber}`
    })
  }
  if (excess > 0.005) {
    jeLines.push({
      accountId: await getAccountId(tx, ADVANCE_ACCOUNT),
      debit: 0,
      credit: excess,
      memo: 'Advance credit'
    })
  }
  await financeService.postJournalEntry(
    {
      description: `Payment for sale ${sale.saleNumber}`,
      sourceModule: 'SALES',
      sourceId: sale.id,
      reference: baseRef,
      postedById: userId,
      date: input.date,
      lines: jeLines
    },
    tx
  )

  let newPaid = round2(Number(invoice.amountPaid))
  let newDue = round2(Number(invoice.balanceDue))
  if (revenuePortion > 0.005) {
    newPaid = round2(Number(invoice.amountPaid) + revenuePortion)
    newDue = round2(Number(invoice.balanceDue) - revenuePortion)
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        amountPaid: newPaid,
        balanceDue: newDue,
        status: newDue <= 0.005 ? 'PAID' : 'PARTIAL',
        ...(newDue <= 0.005 ? { paidAt: dateFromInput(input.date) } : {})
      }
    })
  }

  let saleCompleted = false
  if (newDue <= 0.005 && sale.status === 'DELIVERED') {
    await tx.sale.update({ where: { id: sale.id }, data: { status: 'COMPLETED' } })
    saleCompleted = true
  }

  return {
    paymentTransactionId: receiptHost?.id || paymentTx?.id,
    receiptNumber,
    amountPaid: newPaid,
    balanceDue: newDue,
    saleCompleted,
    overpayment: excess,
    cascadedAmount: cascade.totalCascaded,
    receivableSettled: cascade.receivableSettled
  }
}
