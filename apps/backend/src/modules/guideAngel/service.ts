// @ts-nocheck
import { Prisma } from '@prisma/client'
import { prisma } from '../../database'
import { runWithTenant } from '../../context'
import { AppError } from '../../middleware/errorHandler'
import { auditService } from '../audit'
import { financeService } from '../finance/service'
import { dateFromInput } from '../../utils/dates'
import { GuideAngelDraft, GuideAngelData, GuideAngelSummary } from './types'
import { GuideAngelDraftInput } from './validation'

function asDraft(value: unknown): GuideAngelDraft | undefined {
  if (!value || typeof value !== 'object') return undefined
  return value as GuideAngelDraft
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0)
}

async function getMaterialsCostMap(): Promise<Map<string, number>> {
  const materials = await prisma.material.findMany({ where: { isActive: true }, select: { id: true, costPrice: true } })
  return new Map(materials.map(m => [m.id, Number(m.costPrice || 0)]))
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// Opening FG packs are valued from the variant's BOM at current material
// cost prices — the same roll-up production uses for unit cost, minus the
// discrete-unit rounding (valuation only, no stock movement here).
async function getVariantCostMap(): Promise<Map<string, number>> {
  const variants = await prisma.productVariant.findMany({
    where: { isActive: true },
    select: {
      id: true,
      boms: { select: { qtyPerPack: true, wastagePct: true, material: { select: { costPrice: true } } } }
    }
  })
  const map = new Map<string, number>()
  for (const v of variants) {
    let unitCost = 0
    for (const line of v.boms) {
      const qty = Number(line.qtyPerPack) * (1 + Number(line.wastagePct || 0) / 100)
      unitCost += qty * Number(line.material.costPrice || 0)
    }
    map.set(v.id, round2(unitCost))
  }
  return map
}

const FG_ACCOUNT_BY_CATEGORY: Record<string, string> = {
  BOTTLED: '1325',
  SACHET: '1326',
  JAR: '1327'
}

// Products-first guard: Guide Angel pulls opening FG packs from the
// Products module, so at least one active variant must exist first.
async function requireProductsFirst(): Promise<void> {
  const count = await prisma.productVariant.count({ where: { isActive: true } })
  if (count === 0) {
    throw new AppError(400, 'SETUP_NO_PRODUCTS', 'Create at least one product variant in Products before running Guide Angel')
  }
}

export function summarizeDraft(draft: GuideAngelDraft, materialsMap?: Map<string, number>, variantCostMap?: Map<string, number>): GuideAngelSummary {
  const customerReceivables = sum(draft.customerBalances.map(c => c.receivableAmount || 0))
  const customerDeposits = sum(draft.customerBalances.map(c => c.depositAmount || 0))
  const supplierPayables = sum(draft.supplierBalances.map(s => s.payableAmount || 0))
  const rawStockValue = sum(draft.stockItems.map(s => s.quantity * (materialsMap?.get(s.materialId) ?? 0)))
  const fgItems = draft.fgItems || []
  const fgValue = sum(fgItems.map(f => f.quantity * (variantCostMap?.get(f.variantId) ?? 0)))
  const stockValue = rawStockValue + fgValue
  const bankBalance = sum(draft.bankAccounts.map(b => b.balance || 0))
  const accumulatedDep = draft.accumulatedDepreciation || 0
  const totalDebits = draft.cashBalance + bankBalance + customerReceivables + draft.fixedAssets + stockValue
  const totalCredits = supplierPayables + customerDeposits + draft.loans + draft.ownerCapital + accumulatedDep
  const openingEquity = totalDebits - totalCredits

  return {
    customerCount: draft.customerBalances.length,
    supplierCount: draft.supplierBalances.length,
    stockCount: draft.stockItems.length,
    fgCount: fgItems.length,
    customerReceivables,
    customerDeposits,
    supplierPayables,
    stockValue,
    fgValue,
    cashBalance: draft.cashBalance,
    bankBalance,
    loans: draft.loans,
    fixedAssets: draft.fixedAssets,
    accumulatedDepreciation: accumulatedDep,
    ownerCapital: draft.ownerCapital,
    totalDebits,
    totalCredits: totalCredits + Math.abs(openingEquity),
    balanced: Math.abs(totalDebits - (totalCredits + Math.abs(openingEquity))) <= 0.01,
    openingEquity
  }
}

async function validateDraftBusinessRules(draft: GuideAngelDraft, materialsMap?: Map<string, number>, variantCostMap?: Map<string, number>): Promise<string[]> {
  const errors: string[] = []
  const summary = summarizeDraft(draft, materialsMap, variantCostMap)
  if (summary.totalDebits === 0 && summary.totalCredits === 0) {
    errors.push('Enter at least one opening amount before completing setup')
  }
  const bankNames = new Set<string>()
  draft.bankAccounts.forEach((bank, index) => {
    const key = bank.name.toLowerCase()
    if (bankNames.has(key)) errors.push(`Bank row ${index + 1} is duplicated`)
    bankNames.add(key)
  })
  const fgItems = draft.fgItems || []
  const seenVariants = new Set<string>()
  fgItems.forEach((item, index) => {
    if (seenVariants.has(item.variantId)) errors.push(`Finished-goods row ${index + 1} is duplicated`)
    seenVariants.add(item.variantId)
  })
  if (fgItems.length > 0) {
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: [...seenVariants] } },
      select: { id: true, label: true, isActive: true, boms: { select: { id: true }, take: 1 } }
    })
    const byId = new Map(variants.map(v => [v.id, v]))
    fgItems.forEach((item, index) => {
      const v = byId.get(item.variantId)
      if (!v || !v.isActive) {
        errors.push(`Finished-goods row ${index + 1} references an unknown or archived variant`)
      } else if (item.quantity > 0 && v.boms.length === 0) {
        errors.push(`'${v.label}' has no bill of materials — add a BOM in Products first`)
      }
    })
  }
  return errors
}

async function getAccount(tx: any, code: string) {
  const account = await tx.account.findFirst({ where: { code, isActive: true } })
  if (!account) throw new AppError(400, 'SETUP_ACCOUNT_MISSING', `Required account ${code} is missing. Contact an administrator.`)
  return account
}

async function getOrCreateBankAccount(tx: any, name: string) {
  const parent = await getAccount(tx, '1100')
  const code = `1100-${name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 12) || 'BANK'}`
  const existing = await tx.account.findFirst({ where: { code } })
  if (existing) return existing
  return tx.account.create({
    data: { code, name, type: 'ASSET', parentId: parent.id, isCashAccount: true, description: 'Bank account created by Guide Angel' } as any
  })
}

export const guideAngelService = {

  async getData(): Promise<GuideAngelData> {
    const [customers, suppliers, materials, variants] = await Promise.all([
      prisma.customer.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
      prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
      prisma.material.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, category: true, unitOfMeasure: true, costPrice: true }, orderBy: { name: 'asc' } }),
      prisma.productVariant.findMany({
        where: { isActive: true },
        select: {
          id: true, label: true, packSize: true, unitOfMeasure: true,
          product: { select: { name: true, code: true, category: true } },
          boms: { select: { qtyPerPack: true, wastagePct: true, material: { select: { costPrice: true } } } }
        },
        orderBy: [{ product: { name: 'asc' } }, { label: 'asc' }]
      })
    ])
    return {
      customers,
      suppliers,
      materials: materials.map(m => ({ ...m, costPrice: m.costPrice ? Number(m.costPrice) : 0 })),
      variants: variants.map(v => {
        let unitCost = 0
        for (const line of v.boms) {
          unitCost += Number(line.qtyPerPack) * (1 + Number(line.wastagePct || 0) / 100) * Number(line.material.costPrice || 0)
        }
        return {
          id: v.id,
          label: v.label,
          packSize: v.packSize,
          unitOfMeasure: v.unitOfMeasure,
          productName: v.product.name,
          productCode: v.product.code,
          category: v.product.category,
          unitCost: round2(unitCost)
        }
      })
    }
  },

  async getSession() {
    const session = await prisma.guideAngelSession.findFirst({ include: { openingBalances: true } })
    if (!session) return { id: null, status: 'NOT_STARTED' as const }
    const draft = asDraft(session.draft)
    if (!draft) return { id: session.id, status: session.status, goLiveDate: session.goLiveDate?.toISOString().split('T')[0], draft: undefined, summary: undefined, completedAt: session.completedAt?.toISOString(), assisted: !!session.assistedById }
    const [costMap, variantCostMap] = await Promise.all([getMaterialsCostMap(), getVariantCostMap()])
    return {
      id: session.id, status: session.status,
      goLiveDate: session.goLiveDate?.toISOString().split('T')[0],
      draft, summary: summarizeDraft(draft, costMap, variantCostMap),
      completedAt: session.completedAt?.toISOString(),
      assisted: !!session.assistedById
    }
  },

  async saveDraft(draft: GuideAngelDraftInput, actorId: string, options?: { assistedById?: string; supportReason?: string }) {
    await requireProductsFirst()
    const [costMap, variantCostMap] = await Promise.all([getMaterialsCostMap(), getVariantCostMap()])
    const businessErrors = await validateDraftBusinessRules(draft, costMap, variantCostMap)
    if (businessErrors.length > 0) throw new AppError(400, 'SETUP_VALIDATION', businessErrors.join('; '))
    const existing = await prisma.guideAngelSession.findFirst()
    if (existing?.status === 'COMPLETED') throw new AppError(400, 'SETUP_COMPLETED', 'Guide Angel has already been completed for this organization')
    const session = existing
      ? await prisma.guideAngelSession.update({ where: { id: existing.id }, data: { draft: draft as any, goLiveDate: dateFromInput(draft.goLiveDate), assistedById: options?.assistedById, supportReason: options?.supportReason || draft.supportReason } })
      : await prisma.guideAngelSession.create({ data: { draft: draft as any, goLiveDate: dateFromInput(draft.goLiveDate), createdById: actorId, assistedById: options?.assistedById, supportReason: options?.supportReason || draft.supportReason } as any })
    return { id: session.id, status: session.status, goLiveDate: draft.goLiveDate, draft, summary: summarizeDraft(draft, costMap, variantCostMap), assisted: !!session.assistedById }
  },

  async validateDraft(draft: GuideAngelDraftInput) {
    await requireProductsFirst()
    const [costMap, variantCostMap] = await Promise.all([getMaterialsCostMap(), getVariantCostMap()])
    const businessErrors = await validateDraftBusinessRules(draft, costMap, variantCostMap)
    return { valid: businessErrors.length === 0, errors: businessErrors, summary: summarizeDraft(draft, costMap, variantCostMap) }
  },

  async complete(actorId: string, options?: { assistedById?: string; supportReason?: string }) {
    return prisma.$transaction(async (tx) => {
      const session = await tx.guideAngelSession.findFirst({ include: { openingBalances: true } })
      if (!session) throw new AppError(400, 'SETUP_NOT_STARTED', 'Save Guide Angel before completing setup')
      await requireProductsFirst()
      const [costMap, variantCostMap] = await Promise.all([getMaterialsCostMap(), getVariantCostMap()])
      if (session.status === 'COMPLETED') {
        const draft = asDraft(session.draft)
        return { id: session.id, status: session.status, summary: draft ? summarizeDraft(draft, costMap, variantCostMap) : undefined, completedAt: session.completedAt?.toISOString(), alreadyCompleted: true }
      }
      await tx.$queryRaw`SELECT "id" FROM "GuideAngelSession" WHERE "id" = ${session.id} AND "tenantId" = ${session.tenantId} FOR UPDATE`
      const draft = asDraft(session.draft)
      if (!draft) throw new AppError(400, 'SETUP_NOT_STARTED', 'Save Guide Angel before completing setup')
      const businessErrors = await validateDraftBusinessRules(draft, costMap, variantCostMap)
      if (businessErrors.length > 0) throw new AppError(400, 'SETUP_VALIDATION', businessErrors.join('; '))
      const existingOpening = await tx.guideAngelOpeningBalance.count({ where: { sessionId: session.id } })
      if (existingOpening > 0) throw new AppError(400, 'SETUP_PARTIAL', 'This setup has already started. Contact support before retrying.')

      const openingDate = dateFromInput(draft.goLiveDate)
      let rawStockValue = 0
      let packagingStockValue = 0
      let movementCount = 0

      for (const item of draft.stockItems) {
        const material = await tx.material.findUnique({ where: { id: item.materialId } })
        if (!material) continue

        const cost = Number(material.costPrice || 0)
        const totalQty = item.quantity
        if (totalQty <= 0) continue

        let stock = await tx.stock.findFirst({ where: { materialId: material.id, location: 'MAIN' } })
        if (!stock) stock = await tx.stock.create({ data: { materialId: material.id, location: 'MAIN', quantity: 0 } as any })
        await tx.stock.update({ where: { id: stock.id }, data: { quantity: { increment: totalQty } } })

        await tx.stockMovement.create({
          data: {
            materialId: material.id, type: 'INITIAL', quantity: totalQty,
            reference: `GUIDE-ANGEL-${session.id}`,
            notes: `Opening stock: ${totalQty} ${material.unitOfMeasure}`,
            createdById: actorId
          } as any
        })

        movementCount++
        const value = totalQty * cost
        if (material.category === 'PACKAGING') packagingStockValue += value
        else rawStockValue += value
      }

      // --- FG PACKS ON GROUND: seed FinishedGoodStock @ FG_STORE from the
      // Products module variants. Valued from each variant's BOM at current
      // material cost prices; the opening journal debits 1325/1326/1327 and
      // credits 3000 OBE like any other opening balance.
      const fgValueByAccount = new Map<string, number>()
      let fgMovementCount = 0
      for (const item of draft.fgItems || []) {
        if (item.quantity <= 0) continue
        const variant = await tx.productVariant.findUnique({ where: { id: item.variantId }, include: { product: true } })
        if (!variant || !variant.isActive) continue

        const unitCost = variantCostMap.get(variant.id) ?? 0
        const value = round2(unitCost * item.quantity)
        const fgCode = FG_ACCOUNT_BY_CATEGORY[variant.product.category] || '1325'
        fgValueByAccount.set(fgCode, round2((fgValueByAccount.get(fgCode) || 0) + value))

        const existingFg = await tx.finishedGoodStock.findFirst({
          where: { variantId: variant.id, batchNumber: 'OPENING', location: 'FG_STORE' }
        })
        if (existingFg) {
          const newQty = existingFg.quantity + item.quantity
          const newUnitCost = newQty > 0
            ? round2((existingFg.quantity * Number(existingFg.unitCost) + value) / newQty)
            : unitCost
          await tx.finishedGoodStock.update({ where: { id: existingFg.id }, data: { quantity: newQty, unitCost: newUnitCost } })
        } else {
          await tx.finishedGoodStock.create({
            data: {
              variantId: variant.id,
              batchNumber: 'OPENING',
              location: 'FG_STORE',
              quantity: item.quantity,
              unitCost
            } as any
          })
        }
        fgMovementCount++
      }

      // --- JOURNAL LINES ---
      const accounts = {
        cash: await getAccount(tx, '1000'), receivable: await getAccount(tx, '1200'),
        inventory: await getAccount(tx, '1300'), packaging: await getAccount(tx, '1311'),
        fixedAsset: await getAccount(tx, '1600'), accumulatedDep: await getAccount(tx, '1650'),
        payable: await getAccount(tx, '2000'), deposit: await getAccount(tx, '2250'),
        loans: await getAccount(tx, '2500'), obe: await getAccount(tx, '3000'),
        capital: await getAccount(tx, '3200')
      }

      const lines: { accountId: string; debit: number; credit: number; memo: string }[] = []
      const addDebit = (id: string, amt: number, memo: string) => { if (amt > 0) lines.push({ accountId: id, debit: amt, credit: 0, memo }) }
      const addCredit = (id: string, amt: number, memo: string) => { if (amt > 0) lines.push({ accountId: id, debit: 0, credit: amt, memo }) }

      addDebit(accounts.cash.id, draft.cashBalance, 'Opening cash balance')
      for (const bank of draft.bankAccounts) {
        if (bank.balance <= 0) continue
        const account = await getOrCreateBankAccount(tx, bank.name)
        addDebit(account.id, bank.balance, `Opening bank balance: ${bank.name}`)
      }
      addDebit(accounts.receivable.id, sum(draft.customerBalances.map(c => c.receivableAmount)), 'Opening customer balances')
      addDebit(accounts.inventory.id, rawStockValue, 'Opening raw material stock')
      addDebit(accounts.packaging.id, packagingStockValue, 'Opening packaging stock')
      for (const [code, amount] of fgValueByAccount) {
        addDebit((await getAccount(tx, code)).id, amount, `Opening finished-goods stock (${code})`)
      }
      addDebit(accounts.fixedAsset.id, draft.fixedAssets, 'Opening fixed assets (gross cost)')
      if (draft.accumulatedDepreciation > 0) addCredit(accounts.accumulatedDep.id, draft.accumulatedDepreciation, 'Opening accumulated depreciation')
      addCredit(accounts.payable.id, sum(draft.supplierBalances.map(s => s.payableAmount)), 'Opening supplier balances')
      addCredit(accounts.deposit.id, sum(draft.customerBalances.map(c => c.depositAmount)), 'Opening customer deposits')
      addCredit(accounts.loans.id, draft.loans, 'Opening loans')
      addCredit(accounts.capital.id, draft.ownerCapital, 'Opening owner capital')

      const totalDebit = sum(lines.map(l => l.debit))
      const totalCredit = sum(lines.map(l => l.credit))
      const equityDiff = totalDebit - totalCredit
      if (equityDiff > 0) addCredit(accounts.obe.id, equityDiff, 'Opening balance equity')
      if (equityDiff < 0) addDebit(accounts.obe.id, Math.abs(equityDiff), 'Opening balance equity')

      const journal = await financeService.postJournalEntry({
        description: 'Guide Angel opening balances', sourceModule: 'OPENING', sourceId: session.id,
        reference: `GUIDE-ANGEL-${session.id}`, postedById: actorId, date: draft.goLiveDate, lines
      }, tx)

      // --- OPENING BALANCE RECORDS ---
      for (const balance of draft.customerBalances) {
        if (balance.receivableAmount > 0) {
          const customer = await tx.customer.findUnique({ where: { id: balance.customerId } })
          await tx.guideAngelOpeningBalance.create({
            data: { sessionId: session.id, type: 'CUSTOMER_RECEIVABLE', customerId: balance.customerId, reference: `OPEN-${customer?.code || balance.customerId}`, date: openingDate, amount: new Prisma.Decimal(balance.receivableAmount.toFixed(2)) } as any
          })
        }
        if (balance.depositAmount > 0) {
          const customer = await tx.customer.findUnique({ where: { id: balance.customerId } })
          await tx.guideAngelOpeningBalance.create({
            data: { sessionId: session.id, type: 'CUSTOMER_DEPOSIT', customerId: balance.customerId, reference: `OPEN-${customer?.code || balance.customerId}-DEP`, date: openingDate, amount: new Prisma.Decimal(balance.depositAmount.toFixed(2)) } as any
          })
        }
      }
      for (const balance of draft.supplierBalances) {
        if (balance.payableAmount > 0) {
          const supplier = await tx.supplier.findUnique({ where: { id: balance.supplierId } })
          await tx.guideAngelOpeningBalance.create({
            data: { sessionId: session.id, type: 'SUPPLIER_PAYABLE', supplierId: balance.supplierId, reference: `OPEN-${supplier?.code || balance.supplierId}`, date: openingDate, amount: new Prisma.Decimal(balance.payableAmount.toFixed(2)) } as any
          })
        }
      }

      // --- JAR BALANCES: seed Customer.jarBalance at go-live ---
      for (const balance of draft.customerBalances) {
        if (balance.jarBalance > 0) {
          await tx.customer.update({ where: { id: balance.customerId }, data: { jarBalance: { increment: balance.jarBalance } } })
        }
      }

      const completed = await tx.guideAngelSession.update({
        where: { id: session.id },
        data: { status: 'COMPLETED', completedAt: new Date(), completedById: actorId, assistedById: options?.assistedById || session.assistedById, supportReason: options?.supportReason || session.supportReason }
      })

      await auditService.record({
        userId: actorId, action: 'guide_angel.complete', entityType: 'GuideAngelSession', entityId: session.id,
        description: `Completed Guide Angel setup with ${draft.customerBalances.length} customer balances, ${draft.supplierBalances.length} supplier balances, ${movementCount} stock items and ${fgMovementCount} finished-goods items`,
        metadata: { journalEntryId: journal.id, assistedById: options?.assistedById }
      })

      return { id: completed.id, status: completed.status, summary: summarizeDraft(draft, costMap, variantCostMap), completedAt: completed.completedAt?.toISOString(), journalEntryId: journal.id, alreadyCompleted: false }
    })
  },

  async forTenant(tenantId: string, operation: () => Promise<any>) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, isActive: true } })
    if (!tenant || !tenant.isActive) throw new AppError(404, 'NOT_FOUND', 'Tenant not found or inactive')
    return runWithTenant(tenantId, operation)
  }
}
