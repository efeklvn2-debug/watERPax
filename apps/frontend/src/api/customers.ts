import { api } from './client'

export interface Customer {
  id: string
  name: string
  code: string
  email?: string | null
  phone?: string | null
  address?: string | null
  paymentType?: 'CASH' | 'CREDIT'
  creditLimit?: number
  paymentTermsDays?: number
  discountPercent?: number
  jarBalance?: number
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

export const customersApi = {
  list: async (includeInactive = false) => {
    return api.get<Customer[]>(`/customers${includeInactive ? '?includeInactive=true' : ''}`)
  },
  get: async (id: string) => {
    return api.get<Customer>(`/customers/${id}`)
  },
  create: async (data: { name: string; code?: string; email?: string; phone?: string; address?: string; paymentType?: 'CASH' | 'CREDIT'; creditLimit?: number; paymentTermsDays?: number; discountPercent?: number }) => {
    return api.post<Customer>('/customers', data)
  },
  update: async (id: string, data: Partial<{ name: string; email: string; phone: string; address: string; paymentType: 'CASH' | 'CREDIT'; creditLimit: number; paymentTermsDays: number; discountPercent: number }>) => {
    return api.patch<Customer>(`/customers/${id}`, data)
  },
  deactivate: async (id: string) => {
    return api.patch<Customer>(`/customers/${id}/deactivate`, {})
  },
  balance: async (id: string) => {
    return api.get<CustomerBalance>(`/customers/${id}/balance`)
  },
  transactions: async (id: string) => {
    return api.get<any[]>(`/customers/${id}/transactions`)
  },
  recordJarReturn: async (id: string, data: { quantity: number; notes?: string }) => {
    return api.post<{ customerId: string; quantity: number }>(`/customers/${id}/jar-return`, data)
  },
  allBalances: async () => {
    return api.get<CustomerBalance[]>('/customers/balances')
  }
}
