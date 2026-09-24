export type POStatus = 'PENDING' | 'RECEIVED' | 'PARTIALLY_RECEIVED' | 'CANCELLED'

export interface POLineItem {
  id: string
  purchaseOrderId: string
  materialId: string
  material?: { id: string; code: string; name: string; unitOfMeasure: string; category: string; costPrice?: number }
  quantity: number
  totalWeight?: number | null
  unitPrice: number
  receivedQty: number
  createdAt: Date
}

export interface PurchaseOrder {
  id: string
  poNumber: string
  supplier: string
  status: POStatus
  expectedDate?: Date
  issuedDate?: Date
  receivedDate?: Date
  notes?: string
  totalAmount?: number
  replacesPoId?: string | null
  createdAt: Date
  updatedAt: Date
  createdById?: string
  items?: POLineItem[]
}

export type SupplierInvoiceStatus = 'PENDING' | 'PARTIAL' | 'PAID'

export interface SupplierInvoice {
  id: string
  poId: string
  purchaseOrder?: PurchaseOrder
  supplierId: string
  supplier?: { id: string; name: string }
  invoiceNumber: string
  date: Date
  amount: number
  status: SupplierInvoiceStatus
  amountPaid: number
  createdAt: Date
  payments?: PaymentMade[]
}

export interface PaymentMade {
  id: string
  supplierInvoiceId: string
  supplierInvoice?: SupplierInvoice
  amount: number
  date: Date
  paymentMethod: 'Cash' | 'Bank Transfer'
  reference?: string
  notes?: string
  createdAt: Date
}

export interface SupplierCreditNote {
  id: string
  creditNoteNumber: string
  supplierId: string
  supplier?: { id: string; name: string }
  poId?: string | null
  po?: { id: string; poNumber: string }
  amount: number
  date: Date
  reason: string
  materialId?: string | null
  quantity?: number | null
  notes?: string | null
  createdAt: Date
}
