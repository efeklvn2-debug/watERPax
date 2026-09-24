import { api } from './client'

const API_BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) || '/api'

function getCsrfTokenFromCookie(): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + 'waterpax_csrf' + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

export type SaleStatus = 'DRAFT' | 'CONFIRMED' | 'DELIVERED' | 'COMPLETED' | 'CANCELLED'
export type SaleType = 'OUTRIGHT' | 'REFILL'

export interface SaleLine {
  id: string
  variantId: string
  qty: number
  unitPrice: number
  subtotal: number
  vatAmount: number
  unitCost: number | null
  isRefill: boolean
  variant?: { id: string; label: string; packSize: number; product?: { name: string; category: string } }
}

export interface Sale {
  id: string
  saleNumber: string
  customerId: string
  customer?: { id: string; name: string; code: string }
  status: SaleStatus
  saleType: SaleType
  emptyBrought: number
  totalAmount: number
  notes: string | null
  createdAt: string
  lines?: SaleLine[]
  invoices?: { id: string; invoiceNumber: string; totalAmount: number; amountPaid: number; balanceDue: number; status: string; issuedAt: string | null; dueDate: string | null; paidAt: string | null; createdAt: string; depositApplied?: number; previousPayments?: number }[]
  paymentTransactions?: { id: string; transactionType: string; paymentMethod: string; amount: number; referenceNumber?: string; receivedAt: string; receipts?: { id: string; receiptNumber: string; customerName: string; amount: number; paymentMethod: string; referenceNumber?: string; generatedAt: string }[] }[]
}

export interface SalesInvoice {
  id: string
  invoiceNumber: string
  saleId: string | null
  customerId: string
  totalAmount: number
  amountPaid: number
  balanceDue: number
  depositApplied: number
  previousPayments: number
  status: string
  issuedAt: string | null
  dueDate: string | null
  paidAt: string | null
  customer?: { id: string; name: string; code: string }
  sale?: { id: string; saleNumber: string }
  payments?: any[]
}

export interface SalesPayment {
  id: string
  transactionType: string
  paymentMethod: string
  amount: number
  referenceNumber?: string
  notes?: string
  receivedAt: string
  saleId?: string | null
  customerId?: string | null
  customer?: { id: string; name: string; code: string }
  sale?: { id: string; saleNumber: string }
  receipts?: { id: string; receiptNumber: string; customerName: string; amount: number; paymentMethod: string; referenceNumber?: string; generatedAt: string }[]
}

export interface CustomerCreditNote {
  id: string
  creditNoteNumber: string
  customerId: string
  customer?: { id: string; name: string; code: string }
  saleId?: string | null
  sale?: { id: string; saleNumber: string }
  variantId: string
  variant?: { id: string; label: string; product?: { name: string; category: string } }
  quantity: number
  unitPrice: number
  amount: number
  vatAmount: number
  exVatAmount: number
  reason: string
  disposition: 'RESTOCK' | 'SCRAP'
  refundMethod: 'CREDIT' | 'CASH' | 'BANK'
  date: string
  notes?: string | null
  batchNumber?: string | null
  createdAt: string
}

export const salesApi = {
  list: async (filters?: { status?: string; customerId?: string }) => {
    const params = new URLSearchParams()
    if (filters?.status) params.append('status', filters.status)
    if (filters?.customerId) params.append('customerId', filters.customerId)
    const q = params.toString() ? `?${params.toString()}` : ''
    return api.get<Sale[]>(`/sales${q}`)
  },
  get: async (id: string) => {
    return api.get<Sale>(`/sales/${id}`)
  },
  create: async (data: { customerId: string; notes?: string; saleType?: 'OUTRIGHT' | 'REFILL'; emptyBrought?: number; lines: { variantId: string; qty: number; unitPrice?: number; isRefill?: boolean }[] }) => {
    return api.post<Sale>('/sales', data)
  },
  updateLinePrice: async (saleId: string, lineId: string, unitPrice: number) => {
    return api.patch<Sale>(`/sales/${saleId}/lines/${lineId}/price`, { unitPrice })
  },
  confirm: async (id: string) => {
    return api.post<{ alreadyConfirmed: boolean; sale: Sale }>(`/sales/${id}/confirm`, {})
  },
  deliver: async (id: string, data?: { date?: string; notes?: string; payment?: { method: 'CASH' | 'BANK_TRANSFER'; amount?: number; reference?: string; bankAccountId?: string } }) => {
    return api.post<{ sale: Sale; invoiceId: string; invoiceNumber: string; journalEntryIds: string[] }>(`/sales/${id}/deliver`, data || {})
  },
  recordPayment: async (id: string, data: { amount: number; method: 'CASH' | 'BANK_TRANSFER'; date?: string; reference?: string; notes?: string; bankAccountId?: string }) => {
    return api.post<{ paymentTransactionId: string; receiptNumber?: string; balanceDue: number; saleCompleted: boolean; overpayment?: number; cascadedAmount?: number; receivableSettled?: number }>(`/sales/${id}/payments`, data)
  },
  complete: async (id: string) => {
    return api.post<Sale>(`/sales/${id}/complete`, {})
  },
  cancel: async (id: string, reason?: string) => {
    return api.post<Sale>(`/sales/${id}/cancel`, { reason })
  },
  receiptData: async (id: string) => {
    return api.get<{ sale: Sale; tenantName: string; receipt: { companyName: string; footer: string } }>(`/sales/${id}/receipt`)
  },
  downloadInvoicePdf: async (invoiceId: string) => {
    const headers: Record<string, string> = {}
    const csrf = getCsrfTokenFromCookie()
    if (csrf) headers['X-WaterPax-CSRF'] = csrf
    const res = await fetch(`${API_BASE_URL}/sales/invoices/${invoiceId}/pdf`, { credentials: 'include', headers })
    if (!res.ok) throw new Error('Failed to download invoice PDF')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `invoice-${invoiceId}.pdf`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  },
  downloadReceiptPdf: async (receiptId: string) => {
    const headers: Record<string, string> = {}
    const csrf = getCsrfTokenFromCookie()
    if (csrf) headers['X-WaterPax-CSRF'] = csrf
    const res = await fetch(`${API_BASE_URL}/sales/receipts/${receiptId}/pdf`, { credentials: 'include', headers })
    if (!res.ok) throw new Error('Failed to download receipt PDF')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `receipt-${receiptId}.pdf`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  },

  listInvoices: async (filters?: { status?: string; customerId?: string; dateFrom?: string; dateTo?: string }) => {
    const params = new URLSearchParams()
    if (filters?.status) params.append('status', filters.status)
    if (filters?.customerId) params.append('customerId', filters.customerId)
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom)
    if (filters?.dateTo) params.append('dateTo', filters.dateTo)
    const q = params.toString() ? `?${params.toString()}` : ''
    return api.get<SalesInvoice[]>(`/sales/invoices${q}`)
  },

  listPayments: async (filters?: { customerId?: string; dateFrom?: string; dateTo?: string }) => {
    const params = new URLSearchParams()
    if (filters?.customerId) params.append('customerId', filters.customerId)
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom)
    if (filters?.dateTo) params.append('dateTo', filters.dateTo)
    const q = params.toString() ? `?${params.toString()}` : ''
    return api.get<SalesPayment[]>(`/sales/payments${q}`)
  },

  recordDeposit: async (data: { customerId: string; amount: number; method: 'CASH' | 'BANK_TRANSFER'; date?: string; reference?: string; notes?: string; bankAccountId?: string }) => {
    return api.post<{ paymentTransactionId: string; receiptNumber?: string; depositHeld: number; overpayment?: number; cascadedAmount?: number; receivableSettled?: number }>('/sales/deposits', data)
  },

  getCreditNotes: async (filters?: { customerId?: string; saleId?: string; dateFrom?: string; dateTo?: string }) => {
    const params = new URLSearchParams()
    if (filters?.customerId) params.append('customerId', filters.customerId)
    if (filters?.saleId) params.append('saleId', filters.saleId)
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom)
    if (filters?.dateTo) params.append('dateTo', filters.dateTo)
    const q = params.toString() ? `?${params.toString()}` : ''
    return api.get<CustomerCreditNote[]>(`/sales/credit-notes${q}`)
  },

  createCreditNote: async (data: { customerId: string; saleId: string; variantId: string; quantity: number; reason: string; disposition: 'RESTOCK' | 'SCRAP'; refundMethod?: 'CREDIT' | 'CASH' | 'BANK'; date: string; notes?: string; bankAccountId?: string }) => {
    return api.post<CustomerCreditNote>('/sales/credit-notes', data)
  }
}
