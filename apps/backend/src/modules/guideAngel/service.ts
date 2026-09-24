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

export function summarizeDraft(draft: GuideAngelDraft, materialsMap?: Map<string, number>): GuideAngelSummary {
  const customerReceivables = sum(draft.customerBalances.map(c => c.receivableAmount || 0))
  const customerDeposits = sum(draft.customerBalances.map(c => c.depositAmount || 0))
  const supplierPayables = sum(draft.supplierBalances.map(s => s.payableAmount || 0))
  const stockValue = sum(draft.stockItems.map(s => s.quantity * (materialsMap?.get(s.materialId) ?? 0)))
  const bankBalance = sum(draft.bankAccounts.map(b => b.balance || 0))
  const accumulatedDep = draft.accumulatedDepreciation || 0
  const totalDebits = draft.cashBalance + bankBalance + customerReceivables + draft.fixedAssets + stockValue
  const totalCredits = supplierPayables + customerDeposits + draft.loans + draft.ownerCapital + accumulatedDep
  const openingEquity = totalDebits - totalCredits

  return {
    customerCount: draft.customerBalances.length,
    supplierCount: draft.supplierBalances.length,
    stockCount: draft.stockItems.length,
    customerReceivables,
    customerDeposits,
    supplierPayables,
    stockValue,
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

function validateDraftBusinessRules(draft: GuideAngelDraft, materialsMap?: Map<string, number>): string[] {
  const errors: string[] = []
  const summary = summarizeDraft(draft, materialsMap)
  if (summary.totalDebits === 0 && summary.totalCredits === 0) {
    errors.push('Enter at least one opening amount before completing setup')
  }
  const bankNames = new Set<string>()
  draft.bankAccounts.forEach((bank, index) => {
    const key = bank.name.toLowerCase()
    if (bankNames.has(key)) errors.push(`Bank row ${index + 1} is duplicated`)
    bankNames.add(key)
  })
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
    const [customers, suppliers, materials] = await Promise.all([
      prisma.customer.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
      prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
      prisma.material.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, category: true, unitOfMeasure: true, costPrice: true }, orderBy: { name: 'asc' } })
    ])
    return { customers, suppliers, materials: materials.map(m => ({ ...m, costPrice: m.costPrice ? Number(m.costPrice) : 0 })) }
  },

  async getSession() {
    const session = await prisma.guideAngelSession.findFirst({ include: { openingBalances: true } })
    if (!session) return { id: null, status: 'NOT_STARTED' as const }
    const draft = asDraft(session.draft)
    if (!draft) return { id: session.id, status: session.status, goLiveDate: session.goLiveDate?.toISOString().split('T')[0], draft: undefined, summary: undefined, completedAt: session.completedAt?.toISOString(), assisted: !!session.assistedById }
    const costMap = await getMaterialsCostMap()
    return {
      id: session.id, status: session.status,
      goLiveDate: session.goLiveDate?.toISOString().split('T')[0],
      draft, summary: summarizeDraft(draft, costMap),
      completedAt: session.completedAt?.toISOString(),
      assisted: !!session.assistedById
    }
  },

  async saveDraft(draft: GuideAngelDraftInput, actorId: string, options?: { assistedById?: string; supportReason?: string }) {
    const costMap = await getMaterialsCostMap()
    const businessErrors = validateDraftBusinessRules(draft, costMap)
    if (businessErrors.length > 0) throw new AppError(400, 'SETUP_VALIDATION', businessErrors.join('; '))
    const existing = await prisma.guideAngelSession.findFirst()
    if (existing?.status === 'COMPLETED') throw new AppError(400, 'SETUP_COMPLETED', 'Guide Angel has already been completed for this organization')
    const session = existing
      ? await prisma.guideAngelSession.update({ where: { id: existing.id }, data: { draft: draft as any, goLiveDate: dateFromInput(draft.goLiveDate), assistedById: options?.assistedById, supportReason: options?.supportReason || draft.supportReason } })
      : await prisma.guideAngelSession.create({ data: { draft: draft as any, goLiveDate: dateFromInput(draft.goLiveDate), createdById: actorId, assistedById: options?.assistedById, supportReason: options?.supportReason || draft.supportReason } as any })
    return { id: session.id, status: session.status, goLiveDate: draft.goLiveDate, draft, summary: summarizeDraft(draft, costMap), assisted: !!session.assistedById }
  },

  async validateDraft(draft: GuideAngelDraftInput) {
    const costMap = await getMaterialsCostMap()
    const businessErrors = validateDraftBusinessRules(draft, costMap)
    return { valid: businessErrors.length === 0, errors: businessErrors, summary: summarizeDraft(draft, costMap) }
  },

  async complete(actorId: string, options?: { assistedById?: string; supportReason?: string }) {
    return prisma.$transaction(async (tx) => {
      const session = await tx.guideAngelSession.findFirst({ include: { openingBalances: true } })
      if (!session) throw new AppError(400, 'SETUP_NOT_STARTED', 'Save Guide Angel before completing setup')
      const costMap = await getMaterialsCostMap()
      if (session.status === 'COMPLETED') {
        const draft = asDraft(session.draft)
        return { id: session.id, status: session.status, summary: draft ? summarizeDraft(draft, costMap) : undefined, completedAt: session.completedAt?.toISOString(), alreadyCompleted: true }
      }
      await tx.$queryRaw`SELECT "id" FROM "GuideAngelSession" WHERE "id" = ${session.id} AND "tenantId" = ${session.tenantId} FOR UPDATE`
      const draft = asDraft(session.draft)
      if (!draft) throw new AppError(400, 'SETUP_NOT_STARTED', 'Save Guide Angel before completing setup')
      const businessErrors = validateDraftBusinessRules(draft, costMap)
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

      // --- FG PACKS ON GROUND: if tenant has pre-go-live finished goods, record as 4200 Other Income (optional).

      const completed = await tx.guideAngelSession.update({
        where: { id: session.id },
        data: { status: 'COMPLETED', completedAt: new Date(), completedById: actorId, assistedById: options?.assistedById || session.assistedById, supportReason: options?.supportReason || session.supportReason }
      })

      await auditService.record({
        userId: actorId, action: 'guide_angel.complete', entityType: 'GuideAngelSession', entityId: session.id,
        description: `Completed Guide Angel setup with ${draft.customerBalances.length} customer balances, ${draft.supplierBalances.length} supplier balances, and ${movementCount} stock items`,
        metadata: { journalEntryId: journal.id, assistedById: options?.assistedById }
      })

      return { id: completed.id, status: completed.status, summary: summarizeDraft(draft, costMap), completedAt: completed.completedAt?.toISOString(), journalEntryId: journal.id, alreadyCompleted: false }
    })
  },

  async forTenant(tenantId: string, operation: () => Promise<any>) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, isActive: true } })
    if (!tenant || !tenant.isActive) throw new AppError(404, 'NOT_FOUND', 'Tenant not found or inactive')
    return runWithTenant(tenantId, operation)
  }
}
