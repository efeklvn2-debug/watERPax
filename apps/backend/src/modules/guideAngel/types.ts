export interface GuideAngelCustomerRow {
  id: string
  name: string
  code: string
  receivableAmount: number
  depositAmount: number
  jarBalance: number
}

export interface GuideAngelSupplierRow {
  id: string
  name: string
  code: string
  payableAmount: number
}

export interface GuideAngelStockRow {
  id: string
  code: string
  name: string
  category: string
  unitOfMeasure: string
  costPrice: number
  quantity: number
}

export interface GuideAngelBankRow {
  name: string
  balance: number
}

export interface GuideAngelDraft {
  goLiveDate: string
  cashBalance: number
  bankAccounts: GuideAngelBankRow[]
  loans: number
  fixedAssets: number
  accumulatedDepreciation: number
  ownerCapital: number
  customerBalances: { customerId: string; receivableAmount: number; depositAmount: number; jarBalance: number }[]
  supplierBalances: { supplierId: string; payableAmount: number }[]
  stockItems: { materialId: string; quantity: number }[]
}

export interface GuideAngelSummary {
  customerCount: number
  supplierCount: number
  stockCount: number
  customerReceivables: number
  customerDeposits: number
  supplierPayables: number
  stockValue: number
  cashBalance: number
  bankBalance: number
  loans: number
  fixedAssets: number
  accumulatedDepreciation: number
  ownerCapital: number
  totalDebits: number
  totalCredits: number
  balanced: boolean
  openingEquity: number
}

export interface GuideAngelSessionResult {
  id: string | null
  status: 'NOT_STARTED' | 'DRAFT' | 'COMPLETED'
  goLiveDate?: string
  draft?: GuideAngelDraft
  summary?: GuideAngelSummary
  completedAt?: string
  assisted?: boolean
}

export interface GuideAngelData {
  customers: { id: string; name: string; code: string }[]
  suppliers: { id: string; name: string; code: string }[]
  materials: { id: string; code: string; name: string; category: string; unitOfMeasure: string; costPrice: number }[]
}
