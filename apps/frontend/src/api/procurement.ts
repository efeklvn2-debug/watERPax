import { api } from './client'

export type POStatus = 'PENDING' | 'RECEIVED' | 'PARTIALLY_RECEIVED' | 'CANCELLED'

export interface POLineItem {
  id: string
  purchaseOrderId: string
  materialId: string
  material?: { id: string; code: string; name: string; unitOfMeasure: string; category: string }
  quantity: number
  totalWeight?: number | null
  unitPrice: number
  receivedQty: number
}

export interface PurchaseOrder {
  id: string
  poNumber: string
  supplier: string
  status: POStatus
  expectedDate?: string
  issuedDate?: string
  receivedDate?: string
  notes?: string
  totalAmount?: number
  replacesPoId?: string | null
  createdAt?: string
  items?: POLineItem[]
}

export interface CreatePOLineItem {
  materialId: string
  quantity: number
  unitPrice: number
  totalWeight?: number
}

export type SupplierInvoiceStatus = 'PENDING' | 'PARTIAL' | 'PAID'

export interface SupplierInvoice {
  id: string
  poId: string
  purchaseOrder?: { id: string; poNumber: string; supplier: string; totalAmount?: number }
  supplierId: string
  supplier?: { id: string; name: string }
  invoiceNumber: string
  date: string
  amount: number
  status: SupplierInvoiceStatus
  amountPaid: number
  payments?: PaymentMade[]
}

export interface PaymentMade {
  id: string
  supplierInvoiceId: string
  amount: number
  date: string
  paymentMethod: 'Cash' | 'Bank Transfer'
  reference?: string
  notes?: string
}

export interface SupplierCreditNote {
  id: string
  creditNoteNumber: string
  supplierId: string
  supplier?: { id: string; name: string }
  poId?: string | null
  po?: { id: string; poNumber: string }
  amount: number
  date: string
  reason: string
  materialId?: string | null
  quantity?: number | null
  notes?: string | null
  createdAt: string
}

export const procurementApi = {
  // Purchase Orders
  getPOs: async (status?: string, excludeInvoiced?: boolean) => {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (excludeInvoiced) params.set('excludeInvoiced', 'true')
    const query = params.toString() ? `?${params.toString()}` : ''
    return api.get<PurchaseOrder[]>(`/procurement/purchase-orders${query}`)
  },
  getPO: async (id: string) => api.get<PurchaseOrder>(`/procurement/purchase-orders/${id}`),
  createPO: async (data: {
    supplier: string;
    expectedDate?: string;
    issuedDate?: string;
    notes?: string;
    replacesPoId?: string;
    items: CreatePOLineItem[];
  }) => api.post<PurchaseOrder>('/procurement/purchase-orders', data),

  updatePO: async (id: string, data: { supplier?: string; expectedDate?: string; notes?: string; items?: CreatePOLineItem[] }) =>
    api.patch<PurchaseOrder>(`/procurement/purchase-orders/${id}`, data),

  addLineItem: async (poId: string, data: CreatePOLineItem) =>
    api.post<PurchaseOrder>(`/procurement/purchase-orders/${poId}/items`, data),

  removeLineItem: async (poId: string, lineItemId: string) =>
    api.delete(`/procurement/purchase-orders/${poId}/items/${lineItemId}`),

  deletePO: async (id: string) => api.delete(`/procurement/purchase-orders/${id}`),

  receivePO: async (poId: string, data?: { date?: string; invoice?: { amount: number; date: string; invoiceNumber?: string }; receivedLines?: { lineItemId: string; receivedQty: number }[] }) =>
    api.post<{ po: PurchaseOrder; invoice?: SupplierInvoice }>(`/procurement/purchase-orders/${poId}/receive`, data || {}),

  // Supplier Invoices
  getSupplierInvoices: async (status?: string) => {
    const query = status ? `?status=${status}` : ''
    return api.get<SupplierInvoice[]>(`/procurement/supplier-invoices${query}`)
  },
  getSupplierInvoice: async (id: string) => api.get<SupplierInvoice>(`/procurement/supplier-invoices/${id}`),
  createSupplierInvoice: async (data: { poId: string; date: string; amount: number; invoiceNumber?: string }) =>
    api.post<SupplierInvoice>('/procurement/supplier-invoices', data),
  addPayment: async (id: string, data: { amount: number; date: string; paymentMethod: 'Cash' | 'Bank Transfer'; reference?: string; notes?: string; bankAccountId?: string }) =>
    api.post<PaymentMade>(`/procurement/supplier-invoices/${id}/payments`, data),

  // Credit Notes
  getCreditNotes: async () => api.get<SupplierCreditNote[]>('/procurement/supplier-credit-notes'),
  createCreditNote: async (data: { supplierId: string; poId?: string; amount: number; date: string; reason: string; materialId?: string; quantity?: number; notes?: string }) =>
    api.post<SupplierCreditNote>('/procurement/supplier-credit-notes', data)
}
