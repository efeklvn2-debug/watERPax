export type CustomerPaymentType = 'CASH' | 'CREDIT'

export interface Customer {
  id: string
  name: string
  code: string
  email: string | null
  phone: string | null
  address: string | null
  paymentType: CustomerPaymentType
  creditLimit: number
  paymentTermsDays: number
  discountPercent: number
  jarBalance: number
  isActive: boolean
}

export interface CustomerBalance {
  customerId: string
  totalInvoiced: number
  totalPaid: number
  balanceDue: number
  openInvoices: number
  depositHeld: number
  jarBalance: number
}
