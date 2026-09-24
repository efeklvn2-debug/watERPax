import { auditRepository } from './repository'
import { AuditLogQuery, AuditLogResult, RecordAuditInput } from './types'
import { createChildLogger } from '../../logger'

const logger = createChildLogger('audit:service')

export const auditService = {
  async record(input: RecordAuditInput): Promise<void> {
    try {
      await auditRepository.create({
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        description: input.description,
        metadata: input.metadata ?? undefined,
        ipAddress: input.ipAddress ?? null
      })
    } catch (error) {
      logger.error({ error, action: input.action, entityType: input.entityType, entityId: input.entityId }, 'Failed to write audit log')
    }
  },

  async list(query: AuditLogQuery): Promise<AuditLogResult> {
    return auditRepository.findMany(query)
  },

  async distinctActions(): Promise<string[]> {
    return auditRepository.findDistinctActions()
  },

  async distinctEntityTypes(): Promise<string[]> {
    return auditRepository.findDistinctEntityTypes()
  }
}
