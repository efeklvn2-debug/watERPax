// @ts-nocheck
import { prisma } from '../../database'
import { AppError } from '../../middleware/errorHandler'
import { Prisma } from '@prisma/client'

export const financeRepository = {
  async findAccountByCode(code: string) {
    return prisma.account.findFirst({ where: { code } })
  },

  async findAccountById(id: string) {
    return prisma.account.findUnique({ where: { id } })
  },

  async findAllAccounts(includeInactive = false) {
    return prisma.account.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { code: 'asc' },
      include: { parent: true }
    })
  },

  async findAccountsByType(type: string) {
    return prisma.account.findMany({
      where: { type: type as any, isActive: true },
      orderBy: { code: 'asc' }
    })
  },

  async findRootAccounts() {
    return prisma.account.findMany({
      where: { parentId: null, isActive: true },
      orderBy: { code: 'asc' },
      include: { children: { where: { isActive: true }, orderBy: { code: 'asc' } } }
    })
  },

  async createAccount(data: {
    code: string
    name: string
    type: string
    parentId?: string
    isVatEnabled?: boolean
    isCashAccount?: boolean
    description?: string
  }) {
    return prisma.account.create({ data: data as any })
  },

  async updateAccount(id: string, data: {
    name?: string
    isVatEnabled?: boolean
    isActive?: boolean
  }) {
    return prisma.account.update({ where: { id }, data })
  },

  async getNextEntryNumber(db?: any) {
    const client = db || prisma
    const year = new Date().getFullYear()
    const prefix = `JE-${year}-`
    
    const lastEntry = await client.journalEntry.findFirst({
      where: { entryNumber: { startsWith: prefix } },
      orderBy: { entryNumber: 'desc' }
    })
    
    if (!lastEntry) {
      return `${prefix}0001`
    }
    
    const lastNum = parseInt(lastEntry.entryNumber.replace(prefix, ''))
    return `${prefix}${String(lastNum + 1).padStart(4, '0')}`
  },

  

  async getJournalEntries(options?: {
    dateFrom?: Date
    dateTo?: Date
    sourceModule?: string
    accountId?: string
    limit?: number
    offset?: number
  }) {
    const where: any = {}
    
    if (options?.dateFrom || options?.dateTo) {
      where.date = {}
      if (options.dateFrom) where.date.gte = options.dateFrom
      if (options.dateTo) where.date.lte = options.dateTo
    }
    if (options?.sourceModule) where.sourceModule = options.sourceModule
    if (options?.accountId) {
      where.lines = { some: { accountId: options.accountId } }
    }
    
    return prisma.journalEntry.findMany({
      where,
      include: { lines: { include: { account: true } } },
      orderBy: [{ date: 'desc' }, { entryNumber: 'desc' }],
      take: options?.limit || 50,
      skip: options?.offset || 0
    })
  },

  async getJournalEntryById(id: string) {
    return prisma.journalEntry.findUnique({
      where: { id },
      include: { lines: { include: { account: true } } }
    })
  },

  async getJournalEntriesBySource(sourceModule: string, sourceId: string) {
    return prisma.journalEntry.findMany({
      where: { sourceModule: sourceModule as any, sourceId },
      include: { lines: { include: { account: true } } }
    })
  },

  async getAccountBalance(accountId: string, asOfDate?: Date) {
    const account = await prisma.account.findUnique({ where: { id: accountId } })
    if (!account) throw new AppError(404, 'NOT_FOUND', 'Account not found')

    const dateFilter = asOfDate ? { lte: asOfDate } : {}

    const result = await prisma.journalLine.aggregate({
      where: {
        accountId,
        journalEntry: { date: dateFilter }
      },
      _sum: { debit: true, credit: true }
    })

    const totalDebit = result._sum.debit ? Number(result._sum.debit) : 0
    const totalCredit = result._sum.credit ? Number(result._sum.credit) : 0

    return {
      openingBalance: Number(account.openingBalance),
      totalDebit,
      totalCredit,
      balance: Number(account.openingBalance) + totalDebit - totalCredit
    }
  },

  async getAllAccountBalances(asOfDate?: Date) {
    const accounts = await prisma.account.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' }
    })

    const balances: Record<string, { openingBalance: number; totalDebit: number; totalCredit: number }> = {}

    for (const account of accounts) {
      balances[account.id] = {
        openingBalance: Number(account.openingBalance),
        totalDebit: 0,
        totalCredit: 0
      }
    }

    const dateFilter = asOfDate ? { lte: asOfDate } : {}

    const lines = await prisma.journalLine.findMany({
      where: { journalEntry: { date: dateFilter } },
      include: { account: true }
    })

    for (const line of lines) {
      if (balances[line.accountId]) {
        balances[line.accountId].totalDebit += Number(line.debit)
        balances[line.accountId].totalCredit += Number(line.credit)
      }
    }

    const parentIds = new Set(accounts.filter(a => a.parentId).map(a => a.parentId))

    function aggregateIntoParent(accountId: string): number {
      const base = balances[accountId].openingBalance + balances[accountId].totalDebit - balances[accountId].totalCredit
      const children = accounts.filter(a => a.parentId === accountId)
      if (children.length === 0) return base
      return base + children.reduce((sum, c) => sum + aggregateIntoParent(c.id), 0)
    }

    return accounts.map((acc) => ({
      accountId: acc.id,
      accountCode: acc.code,
      accountName: acc.name,
      accountType: acc.type,
      parentId: acc.parentId,
      ...balances[acc.id],
      isParent: parentIds.has(acc.id),
      balance: parentIds.has(acc.id) ? aggregateIntoParent(acc.id) : balances[acc.id].openingBalance + balances[acc.id].totalDebit - balances[acc.id].totalCredit
    }))
  },

  async getRevenueByPeriod(dateFrom: Date, dateTo: Date) {
    // Water sales post to 4001/4002/4003 (4000 is legacy). Sum all four.
    const salesAccounts = await prisma.account.findMany({
      where: { code: { in: ['4000', '4001', '4002', '4003'] }, isActive: true }
    })
    const packingAccount = await prisma.account.findFirst({ where: { code: '4100' } })
    const otherIncomeAccount = await prisma.account.findFirst({ where: { code: '4200' } })

    const result: Record<string, number> = { sales: 0, packing: 0, otherIncome: 0 }

    if (salesAccounts.length > 0) {
      const salesTotal = await prisma.journalLine.aggregate({
        where: {
          accountId: { in: salesAccounts.map(a => a.id) },
          journalEntry: { date: { gte: dateFrom, lte: dateTo } }
        },
        _sum: { credit: true }
      })
      result.sales = salesTotal._sum.credit ? Number(salesTotal._sum.credit) : 0
    }

    if (packingAccount) {
      const packingTotal = await prisma.journalLine.aggregate({
        where: {
          accountId: packingAccount.id,
          journalEntry: { date: { gte: dateFrom, lte: dateTo } }
        },
        _sum: { credit: true }
      })
      result.packing = packingTotal._sum.credit ? Number(packingTotal._sum.credit) : 0
    }

    if (otherIncomeAccount) {
      const otherTotal = await prisma.journalLine.aggregate({
        where: {
          accountId: otherIncomeAccount.id,
          journalEntry: { date: { gte: dateFrom, lte: dateTo } }
        },
        _sum: { credit: true, debit: true }
      })
      const credits = otherTotal._sum.credit ? Number(otherTotal._sum.credit) : 0
      const debits = otherTotal._sum.debit ? Number(otherTotal._sum.debit) : 0
      result.otherIncome = credits - debits
    }

    return result
  },

  async getExpensesByPeriod(dateFrom: Date, dateTo: Date) {
    // Exclude 2510 CIT Provision: tax computed on profit must not feed back
    // into the next profit computation (below-the-line item).
    const expenseAccounts = await prisma.account.findMany({
      where: { type: 'EXPENSE', isActive: true, code: { not: '2510' } }
    })

    const expenses: Record<string, number> = {}

    for (const account of expenseAccounts) {
      const result = await prisma.journalLine.aggregate({
        where: {
          accountId: account.id,
          journalEntry: { date: { gte: dateFrom, lte: dateTo } }
        },
        _sum: { debit: true }
      })
      expenses[account.code] = result._sum.debit ? Number(result._sum.debit) : 0
    }

    return expenses
  },

  async getCogsByPeriod(dateFrom: Date, dateTo: Date) {
    const cogsAccount = await prisma.account.findFirst({ where: { code: '5000' } })
    const otherCogsAccounts = await prisma.account.findMany({
      where: { code: { in: ['5100', '5200', '5300'] }, isActive: true }
    })

    let total = 0

    if (cogsAccount) {
      const result = await prisma.journalLine.aggregate({
        where: {
          accountId: cogsAccount.id,
          journalEntry: { date: { gte: dateFrom, lte: dateTo } }
        },
        _sum: { debit: true }
      })
      total += result._sum.debit ? Number(result._sum.debit) : 0
    }

    for (const account of otherCogsAccounts) {
      const result = await prisma.journalLine.aggregate({
        where: {
          accountId: account.id,
          journalEntry: { date: { gte: dateFrom, lte: dateTo } }
        },
        _sum: { debit: true, credit: true }
      })
      const credits = result._sum.credit ? Number(result._sum.credit) : 0
      const debits = result._sum.debit ? Number(result._sum.debit) : 0
      total += debits - credits
    }

    return Math.max(0, total)
  },

  async getCashFlow(dateFrom: Date, dateTo: Date) {
    const bankParent = await prisma.account.findFirst({ where: { code: '1100', isActive: true } })
    const cashParent = await prisma.account.findFirst({ where: { code: '1000', isActive: true } })

    const cashAccountIds: string[] = []
    if (cashParent) cashAccountIds.push(cashParent.id)
    if (bankParent) {
      cashAccountIds.push(bankParent.id)
      const bankChildren = await prisma.account.findMany({ where: { parentId: bankParent.id, isActive: true }, select: { id: true } })
      for (const child of bankChildren) cashAccountIds.push(child.id)
    }

    const cashIn = { opening: 0, closing: 0 }

    for (const accountId of cashAccountIds) {
      const opening = await this.getAccountBalance(accountId)
      cashIn.opening += opening.balance

      const closing = await this.getAccountBalance(accountId, dateTo)
      cashIn.closing += closing.balance
    }

    const moneyIn = await prisma.journalLine.aggregate({
      where: {
        accountId: { in: cashAccountIds },
        journalEntry: { date: { gte: dateFrom, lte: dateTo } }
      },
      _sum: { debit: true }
    })

    const moneyOut = await prisma.journalLine.aggregate({
      where: {
        accountId: { in: cashAccountIds },
        journalEntry: { date: { gte: dateFrom, lte: dateTo } }
      },
      _sum: { credit: true }
    })

    return {
      openingBalance: cashIn.opening,
      moneyInToday: moneyIn._sum.debit ? Number(moneyIn._sum.debit) : 0,
      moneyOutToday: moneyOut._sum.credit ? Number(moneyOut._sum.credit) : 0,
      closingBalance: cashIn.closing
    }
  },

  async getOutputVat(dateFrom: Date, dateTo: Date) {
    const vatOutputAccount = await prisma.account.findFirst({ where: { code: '2100' } })
    if (!vatOutputAccount) return 0

    const result = await prisma.journalLine.aggregate({
      where: {
        accountId: vatOutputAccount.id,
        journalEntry: { date: { gte: dateFrom, lte: dateTo } }
      },
      _sum: { credit: true }
    })

    return result._sum.credit ? Number(result._sum.credit) : 0
  },

  async getInputVat(dateFrom: Date, dateTo: Date) {
    const vatInputAccount = await prisma.account.findFirst({ where: { code: '1400' } })
    if (!vatInputAccount) return 0

    const result = await prisma.journalLine.aggregate({
      where: {
        accountId: vatInputAccount.id,
        journalEntry: { date: { gte: dateFrom, lte: dateTo } }
      },
      _sum: { debit: true }
    })

    return result._sum.debit ? Number(result._sum.debit) : 0
  }
}
