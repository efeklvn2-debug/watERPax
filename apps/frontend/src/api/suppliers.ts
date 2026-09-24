import { api } from './client'

export interface Supplier {
  id: string
  name: string
  code: string
  email: string | null
  phone: string | null
  address: string | null
  notes: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  outstandingBalance?: number
  totalBilled?: number
}

export const suppliersApi = {
  getAll: async () => api.get<Supplier[]>('/suppliers'),
  getById: async (id: string) => api.get<Supplier>(`/suppliers/${id}`),
  create: async (data: { name: string; email?: string; phone?: string; address?: string; notes?: string }) =>
    api.post<Supplier>('/suppliers', data),
  update: async (id: string, data: { name?: string; email?: string; phone?: string; address?: string; notes?: string; isActive?: boolean }) =>
    api.patch<Supplier>(`/suppliers/${id}`, data),
  deactivate: async (id: string) => api.patch<Supplier>(`/suppliers/${id}/deactivate`, {})
}
