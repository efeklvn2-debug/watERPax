export interface AgingBucket {
  label: string
  minDays: number
  maxDays: number
  total: number
  count: number
}

export interface AgingEntry {
  id: string
  name: string
  current: number
  age31to60: number
  age61to90: number
  age90plus: number
  total: number
}

export interface AgingReport {
  asOfDate: string
  totalOutstanding: number
  entries: AgingEntry[]
  buckets: AgingBucket[]
}

export interface SalesByCustomerEntry {
  customerId: string
  customerName: string
  invoiceCount: number
  quantityDelivered: number
  revenue: number
  vatAmount: number
  totalAmount: number
}

export interface SalesByCustomerReport {
  from: string
  to: string
  totalRevenue: number
  totalVat: number
  totalAmount: number
  totalInvoices: number
  customers: SalesByCustomerEntry[]
}

export interface SalesByProductEntry {
  product: string
  invoiceCount: number
  quantityDelivered: number
  revenue: number
  percentage: number
}

export interface SalesByProductReport {
  from: string
  to: string
  totalRevenue: number
  totalQuantity: number
  products: SalesByProductEntry[]
}

export interface MovementByType {
  type: string
  totalQuantity: number
  count: number
}

export interface MovementByMaterial {
  materialId: string
  materialName: string
  category: string
  inQuantity: number
  outQuantity: number
  netChange: number
}

export interface InventoryMovementReport {
  from: string
  to: string
  totalIn: number
  totalOut: number
  netChange: number
  byType: MovementByType[]
  byMaterial: MovementByMaterial[]
}

export interface BalanceSheetLine {
  accountId: string
  accountCode: string
  accountName: string
  balance: number
}

export interface BalanceSheetSection {
  type: string
  accounts: BalanceSheetLine[]
  total: number
}

export interface BalanceSheetReport {
  asOfDate: string
  assets: BalanceSheetSection
  liabilities: BalanceSheetSection
  equity: BalanceSheetSection
  currentPeriodProfit: number
  totalAssets: number
  totalLiabilitiesAndEquity: number
  balanced: boolean
}

export interface InventoryGLLine {
  materialId: string
  materialCode: string
  materialName: string
  physicalQty: number
  costPrice: number
  physicalValue: number
}

export interface InventoryGLReport {
  asOfDate: string
  glInventoryBalance: number
  glPackingBalance: number
  physicalInventoryValue: number
  physicalPackingValue: number
  inventoryVariance: number
  packingVariance: number
  materials: InventoryGLLine[]
  balanced: boolean
}

export interface BankMovement {
  date: string
  entryNumber: string
  description: string
  reference: string | null
  debit: number
  credit: number
  balance: number
}

export interface BankMovementReport {
  from: string
  to: string
  accountCode: string
  accountName: string
  openingBalance: number
  closingBalance: number
  movements: BankMovement[]
}
