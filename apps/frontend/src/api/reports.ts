import { api } from './client'
import type { ProfitSummary } from './finance'

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

export interface ProfitRangeReport extends ProfitSummary {
  from: string
  to: string
  grossProfit: number
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

export const reportsApi = {
  getAgingReceivables: async (asOf?: string) => {
    const query = asOf ? `?asOf=${asOf}` : ''
    return api.get<AgingReport>(`/reports/aging/receivables${query}`)
  },

  getAgingPayables: async (asOf?: string) => {
    const query = asOf ? `?asOf=${asOf}` : ''
    return api.get<AgingReport>(`/reports/aging/payables${query}`)
  },

  getSalesByCustomer: async (from: string, to: string) => {
    return api.get<SalesByCustomerReport>(`/reports/sales/by-customer?from=${from}&to=${to}`)
  },

  getSalesByProduct: async (from: string, to: string) => {
    return api.get<SalesByProductReport>(`/reports/sales/by-product?from=${from}&to=${to}`)
  },

  getInventoryMovements: async (from: string, to: string) => {
    return api.get<InventoryMovementReport>(`/reports/inventory/movements?from=${from}&to=${to}`)
  },

  getProfitRange: async (from: string, to: string) => {
    return api.get<ProfitRangeReport>(`/reports/profit?from=${from}&to=${to}`)
  },

  getBalanceSheet: async (asOf?: string) => {
    const query = asOf ? `?asOf=${asOf}` : ''
    return api.get<BalanceSheetReport>(`/reports/balance-sheet${query}`)
  },

  getInventoryGLReconciliation: async (asOf?: string) => {
    const query = asOf ? `?asOf=${asOf}` : ''
    return api.get<InventoryGLReport>(`/reports/inventory/gl-reconciliation${query}`)
  },

  getBankMovements: async (from: string, to: string, accountCode?: string) => {
    let query = `?from=${from}&to=${to}`
    if (accountCode) query += `&accountCode=${accountCode}`
    return api.get<BankMovementReport>(`/reports/bank-movements${query}`)
  },

  // --- Water (MTS) reports ---
  getDashboard: async () => {
    return api.get<{
      fgAvailable: { packs: number; value: number }
      todayProduction: { packs: number; runs: number }
      todaySales: { packs: number; value: number }
      lowRaw: { count: number; items: { code: string; name: string; unit: string; stock: number; minStock: number }[] }
      recentBatches: { runNumber: string; variant: string; product: string; batchNumber: string; packs: number; completedAt: string; unitCost: number }[]
    }>('/reports/dashboard')
  },

  getWaterReport: async (name: 'fg-valuation' | 'fg-grouped' | 'production-output' | 'waste' | 'variance' | 'sales-by-sku' | 'low-raw', from?: string, to?: string, filters?: { category?: string; productId?: string; variantId?: string }) => {
    const params = new URLSearchParams()
    if (from) params.append('from', from)
    if (to) params.append('to', to)
    if (filters?.category) params.append('category', filters.category)
    if (filters?.productId) params.append('productId', filters.productId)
    if (filters?.variantId) params.append('variantId', filters.variantId)
    const q = params.toString() ? `?${params.toString()}` : ''
    return api.get<{ meta: Record<string, unknown>; rows: Record<string, string | number>[]; totals: Record<string, string | number> }>(`/reports/water/${name}${q}`)
  },

  waterReportCsvUrl: (name: string, from?: string, to?: string, filters?: { category?: string; productId?: string; variantId?: string }) => {
    const params = new URLSearchParams()
    if (from) params.append('from', from)
    if (to) params.append('to', to)
    if (filters?.category) params.append('category', filters.category)
    if (filters?.productId) params.append('productId', filters.productId)
    if (filters?.variantId) params.append('variantId', filters.variantId)
    params.append('format', 'csv')
    return `/api/reports/water/${name}?${params.toString()}`
  }
}
