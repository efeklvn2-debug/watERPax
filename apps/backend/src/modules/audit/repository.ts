import { prisma } from '../../database'
import type { Prisma } from '@prisma/client'
import { AuditLogQuery, AuditLogResult, AuditLogEntry } from './types'

export const auditRepository = {
  async create(data: {
    userId?: string | null
    action: string
    entityType: string
    entityId?: string | null
    description: string
    metadata?: any
    ipAddress?: string | null
  }) {
    return prisma.auditLog.create({
      data: {
        userId: data.userId ?? null,
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId ?? null,
        description: data.description,
        metadata: data.metadata ?? undefined,
        ipAddress: data.ipAddress ?? null
      } as any
    })
  },

  async findMany(query: AuditLogQuery): Promise<AuditLogResult> {
    const where: Prisma.AuditLogWhereInput = {}
    if (query.userId) where.userId = query.userId
    if (query.action) where.action = { contains: query.action, mode: 'insensitive' }
    if (query.entityType) where.entityType = { equals: query.entityType, mode: 'insensitive' }
    if (query.entityId) where.entityId = query.entityId
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {}
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom)
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo)
    }

    const limit = Math.min(query.limit ?? 50, 200)
    const offset = query.offset ?? 0

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { user: { select: { username: true } } }
      }),
      prisma.auditLog.count({ where })
    ])

    const items: AuditLogEntry[] = rows.map(r => ({
      id: r.id,
      userId: r.userId,
      username: r.user?.username ?? null,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      description: r.description,
      metadata: r.metadata,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt.toISOString()
    }))

    return { items, total }
  },

  async findDistinctActions(): Promise<string[]> {
    const rows = await prisma.auditLog.findMany({
      select: { action: true },
      distinct: ['action'],
      orderBy: { action: 'asc' }
    })
    return rows.map(r => r.action)
  },

  async findDistinctEntityTypes(): Promise<string[]> {
    const rows = await prisma.auditLog.findMany({
      select: { entityType: true },
      distinct: ['entityType'],
      orderBy: { entityType: 'asc' }
    })
    return rows.map(r => r.entityType)
  }
}
