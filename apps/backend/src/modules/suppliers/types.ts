export interface Supplier {
  id: string
  name: string
  code: string
  email: string | null
  phone: string | null
  address: string | null
  notes: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  outstandingBalance?: number
  totalBilled?: number
}
