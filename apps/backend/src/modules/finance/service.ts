// @ts-nocheck
import { prisma } from '../../database'
import { AppError } from '../../middleware/errorHandler'
import { createChildLogger } from '../../logger'
import { financeRepository } from './repository'
import { Prisma } from '@prisma/client'
import { Account, JournalEntry } from '@prisma/client'
import { dateFromInput, dateStartOfDay, dateEndOfDay } from '../../utils/dates'
import { getCurrentTenantId } from '../../context'
import { DEFAULT_ACCOUNTS } from '@waterpax/types'

const logger = createChildLogger('finance:service')

const ACCOUNT_CACHE: Map<string, Account> = new Map()
const cacheTimestamp = 0
const CACHE_TTL_MS = 60_000

function cacheKey(code: string): string {
  const tenantId = getCurrentTenantId()
  return tenantId ? `${tenantId}:${code}` : code
}

async function loadAccountCache() {
  ACCOUNT_CACHE.clear()
  const accounts = await prisma.account.findMany({ where: { isActive: true } })
  accounts.forEach(acc => ACCOUNT_CACHE.set(cacheKey(acc.code), acc))
}

export const financeService = {
  async getAccounts() {
    return financeRepository.findAllAccounts()
  },

  async getRootAccounts() {
    return financeRepository.findRootAccounts()
  },

  async getAccountById(id: string) {
    const account = await financeRepository.findAccountById(id)
    if (!account) throw new AppError(404, 'NOT_FOUND', 'Account not found')
    return account
  },

  async getAccountByCode(code: string) {
    await loadAccountCache()
    const account = ACCOUNT_CACHE.get(cacheKey(code))
    if (!account) throw new AppError(404, 'NOT_FOUND', `Account ${code} not found`)
    return account
  },

  async getAccountIdByCode(code: string): Promise<string> {
    const account = await this.getAccountByCode(code)
    return account.id
  },

  async getEarliestJournalDate(tx?: any): Promise<Date> {
    const client = tx || prisma
    const earliest = await client.journalEntry.findFirst({
      orderBy: { date: 'asc' },
      select: { date: true }
    })
    return earliest?.date || new Date(new Date().getFullYear() - 5, 0, 1)
  },

  async validateJournalDate(date: Date, tx?: any): Promise<void> {
    const db = tx || prisma
    const earliestDate = await this.getEarliestJournalDate(db)
    const entryDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const earliestDay = new Date(earliestDate.getFullYear(), earliestDate.getMonth(), earliestDate.getDate())
    if (entryDay < earliestDay) {
      throw new AppError(400, 'INVALID_DATE', 
        `Journal date cannot be before earliest entry: ${earliestDate.toISOString().split('T')[0]}`)
    }
    const settings = await db.settings.findFirst()
    if (settings?.booksLockedUntil) {
      const lockDay = new Date(settings.booksLockedUntil.getFullYear(), settings.booksLockedUntil.getMonth(), settings.booksLockedUntil.getDate())
      if (entryDay < lockDay) {
        throw new AppError(400, 'PERIOD_LOCKED',
          `Cannot post entries before ${settings.booksLockedUntil.toISOString().split('T')[0]}. This period is locked.`)
      }
    }
  },

  async createAccount(input: {
    code: string
    name: string
    type: string
    parentId?: string
    isVatEnabled?: boolean
    isCashAccount?: boolean
    description?: string
  }) {
    let type = input.type
    let isCashAccount = input.isCashAccount

    if (input.parentId) {
      const parent = await financeRepository.findAccountById(input.parentId)
      if (!parent) throw new AppError(400, 'INVALID', 'Parent account not found')
      if (parent.code === '1100') {
        type = 'ASSET'
        isCashAccount = true
      }
    }

    let code = input.code
    if (!code && input.parentId) {
      const parent = await financeRepository.findAccountById(input.parentId)
      if (parent?.code === '1100') {
        const sanitized = input.name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 12) || 'BANK'
        code = `1100-${sanitized}`
      }
    }
    if (!code) throw new AppError(400, 'INVALID', 'Account code is required')

    try {
      const account = await financeRepository.createAccount({
        code,
        name: input.name,
        type,
        parentId: input.parentId,
        isVatEnabled: input.isVatEnabled,
        isCashAccount,
        description: input.description
      })
      ACCOUNT_CACHE.set(cacheKey(account.code), account as any)
      return account
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new AppError(400, 'DUPLICATE', `Account code ${code} already exists`)
      }
      throw error
    }
  },

  async postJournalEntry(input: {
    description: string
    sourceModule: string
    sourceId?: string
    reference?: string
    postedById?: string
    date?: string
    lines: { accountId: string; debit: number; credit: number; memo?: string }[]
  }, tx?: any) {
    const { lines, description, sourceModule, sourceId, reference, postedById, date } = input
    const db = tx || prisma

    if (!lines || lines.length < 2) {
      throw new AppError(400, 'INVALID', 'Journal entry must have at least 2 lines')
    }

    // Round every line to kobo and absorb the residual into the largest
    // same-side line. Pro-rata splits (invoice category split, multi-line
    // revenue/COGS) otherwise post entries off by ₦0.01, which Decimal(15,2)
    // storage would silently cement into the ledger.
    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
    for (const line of lines) {
      line.debit = r2(line.debit)
      line.credit = r2(line.credit)
    }
    const residual = r2(lines.reduce((sum, l) => sum + l.debit, 0) - lines.reduce((sum, l) => sum + l.credit, 0))
    if (Math.abs(residual) > 0) {
      const pool = lines.filter(l => (residual > 0 ? l.credit : l.debit) > 0)
      const target = pool.sort((a, b) => (residual > 0 ? b.credit - a.credit : b.debit - a.debit))[0]
      if (!target) {
        throw new AppError(400, 'UNBALANCED', 'Journal entry must balance. Debits and credits are both zero.')
      }
      if (residual > 0) target.credit = r2(target.credit + residual)
      else target.debit = r2(target.debit - residual)
    }

    const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0)
    const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0)

    if (Math.abs(totalDebit - totalCredit) > 0.005) {
      throw new AppError(400, 'UNBALANCED', `Journal entry must balance. Debits: ${totalDebit}, Credits: ${totalCredit}`)
    }

    for (const line of lines) {
      if (line.debit < 0 || line.credit < 0) {
        throw new AppError(400, 'INVALID', 'Debits and credits cannot be negative')
      }
      if (line.debit > 0 && line.credit > 0) {
        throw new AppError(400, 'INVALID', 'A line cannot have both debit and credit')
      }
    }

    const entryDate = dateFromInput(date)
    await this.validateJournalDate(entryDate, db)

    const createEntry = async (client: any, number: string) => {
      const cashAccountIds = new Set<string>()
      const cashAccounts = await client.account.findMany({
        where: {
          OR: [
            { code: '1000' },
            { code: '1100' },
            { parentId: { not: null } }
          ]
        },
        include: { parent: true }
      })
      for (const a of cashAccounts) {
        if (a.code === '1000' || a.code === '1100' || (a.parent && a.parent.code === '1100')) {
          cashAccountIds.add(a.id)
        }
      }

      for (const line of lines) {
        if (line.credit > 0 && cashAccountIds.has(line.accountId)) {
          const account = await client.account.findUnique({ where: { id: line.accountId } })
          const agg = await client.journalLine.aggregate({
            where: { accountId: line.accountId },
            _sum: { debit: true, credit: true }
          })
          const currentBalance = Number(account.openingBalance) +
            Number(agg._sum.debit || 0) - Number(agg._sum.credit || 0)
          if (currentBalance - line.credit < -0.01) {
            throw new AppError(400, 'INSUFFICIENT_CASH',
              `Insufficient funds in ${account.name} (${account.code}). Current balance: ${currentBalance.toFixed(2)}, attempted debit: ${line.credit.toFixed(2)}`)
          }
        }
      }

      const entry = await client.journalEntry.create({
        data: {
          entryNumber: number,
          date: entryDate,
          description,
          sourceModule: sourceModule as any,
          sourceId,
          reference,
          postedById,
          lines: {
            create: lines.map(l => ({
              account: { connect: { id: l.accountId } },
              debit: new Prisma.Decimal(l.debit.toFixed(2)),
              credit: new Prisma.Decimal(l.credit.toFixed(2)),
              memo: l.memo,
              tenant: { connect: { id: getCurrentTenantId()! } },
            })) as any
          }
        },
        include: { lines: { include: { account: true } } }
      })

      logger.info({ entryNumber: entry.entryNumber, sourceModule, sourceId }, 'Journal entry posted')
      return entry
    }

    if (tx) {
      const entryNumber = await financeRepository.getNextEntryNumber(tx)
      return createEntry(tx, entryNumber)
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await prisma.$transaction(async (dbTx) => {
          const entryNumber = await financeRepository.getNextEntryNumber(dbTx)
          return createEntry(dbTx, entryNumber)
        })
      } catch (error: any) {
        if (error?.code === 'P2002' && attempt < 3) {
          logger.warn({ attempt }, 'Entry number collision, retrying...')
          continue
        }
        throw error
      }
    }
    throw new AppError(500, 'ENTRY_CREATION_FAILED', 'Failed to create journal entry after multiple attempts')
  },

  async getJournalEntries(options?: {
    dateFrom?: string
    dateTo?: string
    sourceModule?: string
    accountId?: string
    limit?: number
    offset?: number
  }) {
    return financeRepository.getJournalEntries({
      dateFrom: options?.dateFrom ? dateStartOfDay(options.dateFrom) : undefined,
      dateTo: options?.dateTo ? dateEndOfDay(options.dateTo) : undefined,
      sourceModule: options?.sourceModule,
      accountId: options?.accountId,
      limit: options?.limit,
      offset: options?.offset
    })
  },

  async getJournalEntryById(id: string) {
    const entry = await financeRepository.getJournalEntryById(id)
    if (!entry) throw new AppError(404, 'NOT_FOUND', 'Journal entry not found')
    return entry
  },

  async getAccountBalance(accountId: string, asOfDate?: string) {
    return financeRepository.getAccountBalance(
      accountId,
      asOfDate ? dateEndOfDay(asOfDate) : undefined
    )
  },

  async getAllAccountBalances(asOfDate?: string) {
    return financeRepository.getAllAccountBalances(
      asOfDate ? dateEndOfDay(asOfDate) : undefined
    )
  },

  async getTrialBalance(asOfDate?: string) {
    const allBalances = await financeRepository.getAllAccountBalances(
      asOfDate ? dateEndOfDay(asOfDate) : undefined
    )

    const rootBalances = allBalances.filter((b: any) => !b.parentId)

    function sumNestedDebits(accountId: string): number {
      let sum = allBalances.find((b: any) => b.accountId === accountId)?.totalDebit || 0
      for (const child of allBalances.filter((b: any) => b.parentId === accountId)) {
        sum += sumNestedDebits(child.accountId)
      }
      return sum
    }

    function sumNestedCredits(accountId: string): number {
      let sum = allBalances.find((b: any) => b.accountId === accountId)?.totalCredit || 0
      for (const child of allBalances.filter((b: any) => b.parentId === accountId)) {
        sum += sumNestedCredits(child.accountId)
      }
      return sum
    }

    const accounts = rootBalances.map((b: any) => ({
      ...b,
      totalDebit: sumNestedDebits(b.accountId),
      totalCredit: sumNestedCredits(b.accountId)
    }))

    const totals = accounts.reduce((acc: any, b: any) => ({
      totalDebit: acc.totalDebit + b.totalDebit,
      totalCredit: acc.totalCredit + b.totalCredit,
      totalBalance: acc.totalBalance + b.balance
    }), { totalDebit: 0, totalCredit: 0, totalBalance: 0 })

    return { accounts, totals }
  },

  async getFinanceDashboard(month?: string) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    let startOfMonth: Date
    let endOfMonth: Date
    if (month) {
      const [year, m] = month.split('-').map(Number)
      startOfMonth = new Date(year, m - 1, 1)
      endOfMonth = new Date(year, m, 0, 23, 59, 59)
    } else {
      startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
      endOfMonth = tomorrow
    }

    const cashFlow = await financeRepository.getCashFlow(today, tomorrow)

    const revenue = await financeRepository.getRevenueByPeriod(startOfMonth, endOfMonth)
    const expenses = await financeRepository.getExpensesByPeriod(startOfMonth, endOfMonth)
    const cogs = await financeRepository.getCogsByPeriod(startOfMonth, endOfMonth)

    const totalRevenue = revenue.sales + revenue.packing + revenue.otherIncome
    const totalExpenses = Object.values(expenses).reduce((a, b) => a + b, 0)

    const receivablesAccount = await financeRepository.findAccountByCode('1200')
    let receivablesTotal = 0
    let overdueAmount = 0
    let customerCount = 0

    if (receivablesAccount) {
      const balance = await financeRepository.getAccountBalance(receivablesAccount.id)
      receivablesTotal = Math.max(0, balance.balance)

      const arCustomers = await prisma.invoice.groupBy({
        by: ['customerId'],
        where: {
          status: { in: ['ISSUED', 'PARTIAL', 'OVERDUE'] },
          balanceDue: { gt: 0 }
        }
      })
      customerCount = arCustomers.length

      const overdueResult = await prisma.invoice.aggregate({
        where: {
          status: { in: ['ISSUED', 'PARTIAL', 'OVERDUE'] },
          dueDate: { lt: new Date() },
          balanceDue: { gt: 0 }
        },
        _sum: { balanceDue: true }
      })
      overdueAmount = Number(overdueResult._sum.balanceDue || 0)
    }

    const payablesAccount = await financeRepository.findAccountByCode('2000')
    let payablesTotal = 0
    const supplierCount = 0

    if (payablesAccount) {
      const balance = await financeRepository.getAccountBalance(payablesAccount.id)
      payablesTotal = Math.abs(Math.min(0, balance.balance))
    }

    return {
      cashPosition: {
        openingBalance: cashFlow.openingBalance,
        moneyInToday: cashFlow.moneyInToday,
        moneyOutToday: cashFlow.moneyOutToday,
        closingBalance: cashFlow.closingBalance
      },
      receivables: {
        totalOwed: receivablesTotal,
        overdueAmount,
        customerCount
      },
      payables: {
        totalPayable: payablesTotal,
        supplierCount
      },
      profitSnapshot: {
        revenueThisMonth: totalRevenue,
        revenueBreakdown: {
          salesRevenue: revenue.sales,
          packingRevenue: revenue.packing,
          otherIncome: revenue.otherIncome
        },
        materialCostThisMonth: cogs,
        expensesThisMonth: totalExpenses,
        netProfit: totalRevenue - cogs - totalExpenses
      }
    }
  },

  async getVatSummary(dateFrom?: string, dateTo?: string) {
    const from = dateFrom ? dateStartOfDay(dateFrom) : new Date(new Date().getFullYear(), 0, 1)
    const to = dateTo ? dateEndOfDay(dateTo) : new Date()

    const outputVat = await financeRepository.getOutputVat(from, to)
    const inputVat = await financeRepository.getInputVat(from, to)

    const periods: { month: string; outputVat: number; inputVat: number; vatPayable: number }[] = []
    const startYear = from.getFullYear()
    const startMonth = from.getMonth()
    const endYear = to.getFullYear()
    const endMonth = to.getMonth()
    const cursor = new Date(startYear, startMonth, 1)
    while (cursor <= to) {
      const periodStart = new Date(cursor)
      const periodEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59)
      const monthOutput = await financeRepository.getOutputVat(periodStart, periodEnd)
      const monthInput = await financeRepository.getInputVat(periodStart, periodEnd)
      periods.push({
        month: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`,
        outputVat: monthOutput,
        inputVat: monthInput,
        vatPayable: monthOutput - monthInput
      })
      cursor.setMonth(cursor.getMonth() + 1)
    }

    return {
      outputVat,
      inputVat,
      vatPayable: outputVat - inputVat,
      periods
    }
  },

  async getProfitSummary(month?: string) {
    let startOfMonth: Date
    let endOfMonth: Date

    if (month) {
      const [year, monthNum] = month.split('-').map(Number)
      startOfMonth = new Date(year, monthNum - 1, 1)
      endOfMonth = new Date(year, monthNum, 0, 23, 59, 59)
    } else {
      const today = new Date()
      startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
      endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59)
    }

    const revenue = await financeRepository.getRevenueByPeriod(startOfMonth, endOfMonth)
    const expenses = await financeRepository.getExpensesByPeriod(startOfMonth, endOfMonth)
    const cogs = await financeRepository.getCogsByPeriod(startOfMonth, endOfMonth)

    const totalRevenue = revenue.sales + revenue.packing + revenue.otherIncome
    const totalExpenses = Object.values(expenses).reduce((a, b) => a + b, 0)

    return {
      revenue: totalRevenue,
      breakdown: {
        salesRevenue: revenue.sales,
        packingRevenue: revenue.packing,
        otherIncome: revenue.otherIncome
      },
      costOfGoodsSold: cogs,
      expenses: totalExpenses,
      expenseBreakdown: expenses,
      netProfit: totalRevenue - cogs - totalExpenses
    }
  },

  async getGeneralLedger(accountId: string, dateFrom?: string, dateTo?: string) {
    const account = await financeRepository.findAccountById(accountId)
    if (!account) throw new AppError(404, 'NOT_FOUND', 'Account not found')

    const openingBalance = await financeRepository.getAccountBalance(
      accountId,
      dateFrom ? dateStartOfDay(dateFrom) : undefined
    )

    const entries = await prisma.journalLine.findMany({
      where: {
        accountId,
        journalEntry: {
          date: {
            ...(dateFrom && { gte: dateStartOfDay(dateFrom) }),
            ...(dateTo && { lte: dateEndOfDay(dateTo) })
          }
        }
      },
      include: { journalEntry: true },
      orderBy: { journalEntry: { date: 'asc' } }
    })

    let runningBalance = openingBalance.openingBalance + openingBalance.totalDebit - openingBalance.totalCredit

    const transactions = entries.map((line: any) => {
      runningBalance += Number(line.debit) - Number(line.credit)
      return {
        date: line.journalEntry.date,
        entryNumber: line.journalEntry.entryNumber,
        description: line.journalEntry.description,
        reference: line.journalEntry.reference,
        debit: Number(line.debit),
        credit: Number(line.credit),
        balance: runningBalance,
        memo: line.memo
      }
    })

    return {
      account: {
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type
      },
      openingBalance: openingBalance.openingBalance,
      closingBalance: runningBalance,
      transactions
    }
  },

  async seedDefaultAccounts() {
    const accounts = DEFAULT_ACCOUNTS

    let created = 0
    for (const acc of accounts) {
      const tenantId = getCurrentTenantId()
      await prisma.account.upsert({
        where: { tenantId_code: { tenantId: tenantId!, code: acc.code } },
        create: acc as any,
        update: {}
      })
      created++
    }

    logger.info({ count: created }, 'Chart of accounts seeded')
    return { message: 'Chart of accounts seeded', count: created }
  },

  async getDeferredCogsSummary() {
    try {
      // MTS model: runs post straight Dr FG / Cr Raw at completion and COGS
      // reliefs at delivery, so nothing ever sits "deferred" the MTO way.
      // Report the real 1330 balance (expected 0) with an empty order list.
      // (Legacy MTO READY/PICKED_UP order logic removed with salesOrders.)
      const deferredCogsAccount = await this.getAccountByCode('1330')
      const balanceResult = await financeRepository.getAccountBalance(deferredCogsAccount.id)
      const totalDeferred = Math.max(0, Number(balanceResult?.balance || 0))

      // No pending orders in MTS — empty list keeps the Finance UI rendering.
      return {
        totalDeferred,
        pendingCount: 0,
        overdueCount: 0,
        orders: []
      }
    } catch (error) {
      logger.error({ error }, 'Failed to get Deferred COGS summary')
      throw new AppError(500, 'INTERNAL_ERROR', 'Failed to get Deferred COGS summary')
    }
  },

  async recognizeDeferredCogs(orderId: string, userId?: string) {
    // MTS model: COGS posts automatically at sale delivery. Manual deferred
    // recognition was an MTO concept (READY/PICKED_UP orders holding job
    // cost in 1330) and no longer applies. Fail explicitly instead of
    // querying the removed salesOrder↔productionJob coupling.
    throw new AppError(
      400,
      'NOT_APPLICABLE',
      'Deferred COGS recognition does not apply to make-to-stock sales: COGS posts automatically on delivery.'
    )
  },

  async reverseJournalEntry(entryId: string, userId?: string) {
    return prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findUnique({
        where: { id: entryId },
        include: { lines: true }
      })
      if (!entry) throw new AppError(404, 'NOT_FOUND', 'Journal entry not found')

      // Guard against double reversal
      const existingReversal = await tx.journalEntry.findFirst({
        where: {
          sourceModule: entry.sourceModule,
          sourceId: entry.sourceId,
          description: { startsWith: `Reversal of ${entry.entryNumber}` }
        }
      })
      if (existingReversal) {
        throw new AppError(400, 'ALREADY_REVERSED', `Entry ${entry.entryNumber} was already reversed (${existingReversal.entryNumber})`)
      }

      const reversedLines = entry.lines.map(l => ({
        accountId: l.accountId,
        debit: Number(l.credit),
        credit: Number(l.debit),
        memo: `Reversal: ${l.memo || ''}`
      }))

        return this.postJournalEntry({
          description: `Reversal of ${entry.entryNumber} - ${entry.description}`,
          sourceModule: entry.sourceModule,
          sourceId: entry.sourceId || undefined,
          reference: entry.reference || undefined,
          postedById: userId,
          lines: reversedLines
        }, tx)
    })
  }
}
