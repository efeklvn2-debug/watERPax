export type SaleStatus = 'DRAFT' | 'CONFIRMED' | 'DELIVERED' | 'COMPLETED' | 'CANCELLED'
export type SaleType = 'OUTRIGHT' | 'REFILL'
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER'

export interface SaleLineInput {
  variantId: string
  qty: number
  unitPrice?: number
  isRefill?: boolean
}

export interface SaleLineAllocation {
  stockId: string
  batchNumber: string
  qty: number
}

export interface ConfirmResult {
  alreadyConfirmed: boolean
  sale: unknown
}

export interface DeliverResult {
  sale: unknown
  invoiceId: string
  invoiceNumber: string
  journalEntryIds: string[]
  payment?: unknown
}

export interface PaymentResult {
  paymentTransactionId: string
  receiptNumber?: string
  amountPaid: number
  balanceDue: number
  saleCompleted: boolean
}
