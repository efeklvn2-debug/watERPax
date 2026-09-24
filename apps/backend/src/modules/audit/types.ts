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

export interface AuditLogResult {
  items: AuditLogEntry[]
  total: number
}

export interface RecordAuditInput {
  userId?: string | null
  action: string
  entityType: string
  entityId?: string | null
  description: string
  metadata?: any
  ipAddress?: string | null
}
