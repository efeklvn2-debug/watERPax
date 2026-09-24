import { api } from './client'

export interface Account {
  id: string
  code: string
  name: string
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE' | 'COGS'
  parentId: string | null
  isVatEnabled: boolean
  isCashAccount: boolean
  isActive: boolean
  description: string | null
  openingBalance: string
}

export interface JournalLine {
  id: string
  journalEntryId: string
  accountId: string
  debit: string
  credit: string
  memo: string | null
  account: Account
}

export interface JournalEntry {
  id: string
  entryNumber: string
  date: string
  description: string
  sourceModule: string
  sourceId: string | null
  reference: string | null
  postedById: string | null
  postedAt: string
  isPosted: boolean
  lines: JournalLine[]
}

export interface AccountBalance {
  accountId: string
  accountCode: string
  accountName: string
  accountType: string
  parentId: string | null
  openingBalance: number
  totalDebit: number
  totalCredit: number
  balance: number
  isParent?: boolean
}

export interface TrialBalance {
  accounts: AccountBalance[]
  totals: {
    totalDebit: number
    totalCredit: number
    totalBalance: number
  }
}

export interface CashPosition {
  openingBalance: number
  moneyInToday: number
  moneyOutToday: number
  closingBalance: number
}

export interface ReceivablesSummary {
  totalOwed: number
  overdueAmount: number
  customerCount: number
}

export interface PayablesSummary {
  totalPayable: number
  supplierCount: number
}

export interface ProfitSnapshot {
  revenueThisMonth: number
  revenueBreakdown: {
    salesRevenue: number
    packingRevenue: number
    otherIncome: number
  }
  materialCostThisMonth: number
  expensesThisMonth: number
  netProfit: number
}

export interface FinanceDashboard {
  cashPosition: CashPosition
  receivables: ReceivablesSummary
  payables: PayablesSummary
  profitSnapshot: ProfitSnapshot
}

export interface VatPeriod {
  month: string
  outputVat: number
  inputVat: number
  vatPayable: number
}

export interface VatSummary {
  outputVat: number
  inputVat: number
  vatPayable: number
  periods: VatPeriod[]
}

export interface ProfitSummary {
  revenue: number
  breakdown: {
    salesRevenue: number
    packingRevenue: number
    otherIncome: number
  }
  costOfGoodsSold: number
  expenses: number
  expenseBreakdown: Record<string, number>
  netProfit: number
}

export interface LedgerTransaction {
  date: string
  entryNumber: string
  description: string
  reference: string | null
  debit: number
  credit: number
  balance: number
  memo: string | null
}

export interface GeneralLedger {
  account: {
    id: string
    code: string
    name: string
    type: string
  }
  openingBalance: number
  closingBalance: number
  transactions: LedgerTransaction[]
}

export interface JournalEntryInput {
  description: string
  sourceModule: string
  sourceId?: string
  reference?: string
  date?: string
  lines: {
    accountId: string
    debit: number
    credit: number
    memo?: string
  }[]
}

export const financeApi = {
  // Accounts
  getAccounts: () => api.get<Account[]>('/finance/accounts'),
  getRootAccounts: () => api.get<Account[]>('/finance/accounts/tree'),
  getAccountById: (id: string) => api.get<Account>(`/finance/accounts/${id}`),
  createAccount: (data: Partial<Account>) => api.post<Account>('/finance/accounts', data),
  seedAccounts: () => api.post<{ message: string; count: number }>('/finance/seed', {}),

  // Journal
  getJournalEntries: (params?: { dateFrom?: string; dateTo?: string; sourceModule?: string; accountId?: string; limit?: number; offset?: number }) => {
    const query = new URLSearchParams()
    if (params?.dateFrom) query.append('dateFrom', params.dateFrom)
    if (params?.dateTo) query.append('dateTo', params.dateTo)
    if (params?.sourceModule) query.append('sourceModule', params.sourceModule)
    if (params?.accountId) query.append('accountId', params.accountId)
    if (params?.limit) query.append('limit', String(params.limit))
    if (params?.offset) query.append('offset', String(params.offset))
    const queryStr = query.toString()
    return api.get<JournalEntry[]>(`/finance/journal${queryStr ? '?' + queryStr : ''}`)
  },
  getJournalEntryById: (id: string) => api.get<JournalEntry>(`/finance/journal/${id}`),
  postJournalEntry: (data: JournalEntryInput) => api.post<JournalEntry>('/finance/journal', data),
  reverseJournalEntry: (id: string) => api.post<JournalEntry>(`/finance/journal/${id}/reverse`, {}),

  // Balances
  getAllBalances: () => api.get<AccountBalance[]>('/finance/balances'),
  getAccountBalance: (id: string, asOfDate?: string) => {
    const query = asOfDate ? `?asOfDate=${asOfDate}` : ''
    return api.get<{ openingBalance: number; totalDebit: number; totalCredit: number; balance: number }>(`/finance/balances/${id}${query}`)
  },
  getTrialBalance: (asOfDate?: string) => {
    const query = asOfDate ? `?asOfDate=${asOfDate}` : ''
    return api.get<TrialBalance>(`/finance/trial-balance${query}`)
  },
  getGeneralLedger: (accountId: string, dateFrom?: string, dateTo?: string) => {
    const query = new URLSearchParams()
    if (dateFrom) query.append('dateFrom', dateFrom)
    if (dateTo) query.append('dateTo', dateTo)
    const queryStr = query.toString()
    return api.get<GeneralLedger>(`/finance/ledger/${accountId}${queryStr ? '?' + queryStr : ''}`)
  },

  // Deferred COGS
  getDeferredCogsSummary: () => api.get<DeferredCogsSummary>('/finance/deferred-cogs'),
  recognizeDeferredCogs: (orderId: string) => api.post<{ success: boolean; amount: number }>(`/finance/deferred-cogs/${orderId}/recognize`, {}),

  // Reports
  getDashboard: (month?: string) => {
    const query = month ? `?month=${month}` : ''
    return api.get<FinanceDashboard>(`/finance/dashboard${query}`)
  },
  getVatSummary: (dateFrom?: string, dateTo?: string) => {
    const query = new URLSearchParams()
    if (dateFrom) query.append('dateFrom', dateFrom)
    if (dateTo) query.append('dateTo', dateTo)
    const queryStr = query.toString()
    return api.get<VatSummary>(`/finance/vat${queryStr ? '?' + queryStr : ''}`)
  },
  getProfitSummary: (month?: string) => {
    const query = month ? `?month=${month}` : ''
    return api.get<ProfitSummary>(`/finance/profit${query}`)
  }
}

export interface DeferredCogsOrder {
  id: string
  orderNumber: string
  customerName: string
  deferredAmount: number
  completedAt: string
  daysPending: number
}

export interface DeferredCogsSummary {
  totalDeferred: number
  pendingCount: number
  overdueCount: number
  orders: DeferredCogsOrder[]
}
