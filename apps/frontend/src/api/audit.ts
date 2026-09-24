import { api } from './client'

export interface AuditLogEntry {
  id: string
  userId: string | null
  username: string | null
  action: string
  entityType: string
  entityId: string | null
  description: string
  metadata: any
  ipAddress: string | null
  createdAt: string
}

export interface AuditLogResult {
  items: AuditLogEntry[]
  total: number
}

export interface AuditLogQuery {
  userId?: string
  action?: string
  entityType?: string
  entityId?: string
  dateFrom?: string
  dateTo?: string
  limit?: number
  offset?: number
}

export const auditApi = {
  list: async (query: AuditLogQuery = {}) => {
    const params = new URLSearchParams()
    if (query.userId) params.set('userId', query.userId)
    if (query.action) params.set('action', query.action)
    if (query.entityType) params.set('entityType', query.entityType)
    if (query.entityId) params.set('entityId', query.entityId)
    if (query.dateFrom) params.set('dateFrom', query.dateFrom)
    if (query.dateTo) params.set('dateTo', query.dateTo)
    if (query.limit) params.set('limit', String(query.limit))
    if (query.offset) params.set('offset', String(query.offset))
    const qs = params.toString()
    return api.get<AuditLogResult>(`/audit${qs ? `?${qs}` : ''}`)
  },

  distinctActions: async () => {
    return api.get<string[]>('/audit/actions')
  },

  distinctEntityTypes: async () => {
    return api.get<string[]>('/audit/entity-types')
  }
}
