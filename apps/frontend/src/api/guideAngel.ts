import { api } from './client'

export interface GuideAngelCustomerRow {
  id: string; name: string; code: string
  receivableAmount: number; depositAmount: number; jarBalance: number
}

export interface GuideAngelSupplierRow {
  id: string; name: string; code: string
  payableAmount: number
}

export interface GuideAngelStockRow {
  id: string; code: string; name: string
  category: string; unitOfMeasure: string; costPrice: number
  quantity: number
}

export interface GuideAngelData {
  customers: { id: string; name: string; code: string }[]
  suppliers: { id: string; name: string; code: string }[]
  materials: { id: string; code: string; name: string; category: string; unitOfMeasure: string; costPrice: number }[]
}

export interface GuideAngelDraft {
  goLiveDate: string
  cashBalance: number; bankAccounts: { name: string; balance: number }[]
  loans: number; fixedAssets: number; accumulatedDepreciation: number; ownerCapital: number
  customerBalances: { customerId: string; receivableAmount: number; depositAmount: number; jarBalance: number }[]
  supplierBalances: { supplierId: string; payableAmount: number }[]
  stockItems: { materialId: string; quantity: number }[]
}

export interface GuideAngelSummary {
  customerCount: number; supplierCount: number; stockCount: number
  customerReceivables: number; customerDeposits: number; supplierPayables: number; stockValue: number
  cashBalance: number; bankBalance: number; loans: number; fixedAssets: number
  accumulatedDepreciation: number; ownerCapital: number
  totalDebits: number; totalCredits: number; balanced: boolean; openingEquity: number
}

export interface GuideAngelSession {
  id: string | null; status: 'NOT_STARTED' | 'DRAFT' | 'COMPLETED'
  goLiveDate?: string; draft?: GuideAngelDraft; summary?: GuideAngelSummary
  completedAt?: string; assisted?: boolean
}

export interface GuideAngelValidation { valid: boolean; errors: string[]; summary: GuideAngelSummary }

const base = (tenantId?: string) => tenantId ? `/platform/tenants/${tenantId}/guide-angel` : '/guide-angel'

export const guideAngelApi = {
  data: (tenantId?: string) => api.get<GuideAngelData>(`${base(tenantId)}/data`),
  get: (tenantId?: string) => api.get<GuideAngelSession>(base(tenantId)),
  save: (draft: GuideAngelDraft, tenantId?: string, supportReason?: string) => api.post<GuideAngelSession>(`${base(tenantId)}/save`, { draft, supportReason }),
  validate: (draft: GuideAngelDraft, tenantId?: string) => api.post<GuideAngelValidation>(`${base(tenantId)}/validate`, { draft }),
  complete: (tenantId?: string, supportReason?: string) => api.post<{ id: string; status: 'COMPLETED'; summary: GuideAngelSummary; completedAt?: string }>(`${base(tenantId)}/complete`, { confirm: true, supportReason })
}
