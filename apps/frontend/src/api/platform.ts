import { api } from './client'

export interface Tenant {
  id: string
  name: string
  slug: string
  isActive: boolean
  createdAt: string
  updatedAt?: string
  userCount?: number
  salesOrderCount?: number
  customerCount?: number
}

export interface TenantDetail extends Tenant {
  users: Array<{
    id: string
    username: string
    role: string
    isActive: boolean
    createdAt: string
  }>
  _count: {
    salesOrders: number
    customers: number
    materials: number
    productionJobs: number
  }
}

export interface CreateTenantInput {
  name: string
  slug: string
}

export interface CreateTenantUserInput {
  username: string
  password: string
  role: 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'VIEWER'
}

export const platformApi = {
  async listTenants() {
    return api.get<Tenant[]>('/platform/tenants')
  },

  async getTenant(id: string) {
    return api.get<TenantDetail>(`/platform/tenants/${id}`)
  },

  async createTenant(input: CreateTenantInput) {
    return api.post<Tenant>('/platform/tenants', input)
  },

  async updateTenant(id: string, input: { name?: string; isActive?: boolean }) {
    return api.patch<Tenant>(`/platform/tenants/${id}`, input)
  },

  async createTenantUser(tenantId: string, input: CreateTenantUserInput) {
    return api.post<CreateTenantUserInput>(`/platform/tenants/${tenantId}/users`, input)
  },

  async deleteTenant(id: string) {
    return api.delete<{ id: string; name: string }>(`/platform/tenants/${id}`)
  },

  async deleteTenantUser(tenantId: string, userId: string) {
    return api.delete<{ id: string; username: string }>(`/platform/tenants/${tenantId}/users/${userId}`)
  },
}
