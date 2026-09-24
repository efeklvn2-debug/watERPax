import { AccountType as PrismaAccountType, SourceModule as PrismaSourceModule } from '@prisma/client'

export type AccountType = PrismaAccountType
export type SourceModule = PrismaSourceModule

export interface AccountInput {
  code: string
  name: string
  type: AccountType
  parentId?: string
  isVatEnabled?: boolean
  description?: string
}

export interface JournalLineInput {
  accountId: string
  debit: number
  credit: number
  memo?: string
}

export interface JournalEntryInput {
  date?: Date
  description: string
  sourceModule: SourceModule
  sourceId?: string
  reference?: string
  lines: JournalLineInput[]
  postedById?: string
}

export interface AccountBalance {
  accountId: string
  accountCode: string
  accountName: string
  accountType: AccountType
  debit: number
  credit: number
  balance: number
}

export interface AccountWithBalance extends AccountBalance {
  children?: AccountWithBalance[]
  openingBalance: number
}

export interface FinanceDashboard {
  cashPosition: {
    openingBalance: number
    moneyInToday: number
    moneyOutToday: number
    closingBalance: number
  }
  receivables: {
    totalOwed: number
    overdueAmount: number
    customerCount: number
  }
  payables: {
    totalPayable: number
    supplierCount: number
  }
  profitSnapshot: {
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
}

export interface VatSummary {
  outputVat: number
  inputVat: number
  vatPayable: number
}

export interface ReceivableAging {
  customerId: string
  customerName: string
  totalOwed: number
  current: number
  days31to60: number
  days61to90: number
  days90Plus: number
}

export interface PayableAging {
  supplierId: string
  supplierName: string
  totalOwed: number
  current: number
  days31to60: number
  days61to90: number
  days90Plus: number
}
