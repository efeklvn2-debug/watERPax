import { PrismaClient } from '@prisma/client'
import pino from 'pino'
import { getCurrentTenantId } from '../context'

const logger = pino({ name: 'database' })

const GLOBAL_MODELS = new Set([
  'Tenant',
  'Permission',
  'RolePermission',
  'UserPermission',
  'BlockedIp',
])

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrisma() {
  const base = new PrismaClient({
    log: [
      { level: 'error', emit: 'stdout' },
      { level: 'warn', emit: 'stdout' },
    ],
  })

  const extended = base.$extends({
    name: 'tenantContext',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: any) {
          if (!model || !operation) return query(args)

          const modelName = String(model)
          if (GLOBAL_MODELS.has(modelName)) {
            return query(args)
          }

          const tenantId = getCurrentTenantId()
          if (!tenantId) {
            return query(args)
          }

          const a = args as Record<string, unknown>

          switch (operation) {
            case 'create':
              if (a.data && typeof a.data === 'object') {
                ;(a.data as any).tenantId = tenantId
              }
              break
            case 'createMany':
              if (a.data && Array.isArray(a.data)) {
                for (const item of a.data) {
                  ;(item as any).tenantId = tenantId
                }
              }
              break
            case 'upsert':
              if (a.create && typeof a.create === 'object') {
                ;(a.create as any).tenantId = tenantId
              }
              // NOTE: Do NOT add tenantId to upsert's where clause.
              // upsert requires a unique filter; adding tenantId breaks it
              // for models with globally unique fields (username, code, etc.).
              // The create part still gets tenantId injected.
              break
            case 'findUnique':
            case 'findFirst':
            case 'findMany':
            case 'findUniqueOrThrow':
            case 'findFirstOrThrow':
            case 'update':
            case 'updateMany':
            case 'delete':
            case 'deleteMany':
            case 'count':
            case 'aggregate':
            case 'groupBy':
              if (!a.where) a.where = {}
              if (!(a.where as any).tenantId) {
                ;(a.where as any).tenantId = tenantId
              }
              break
          }

          return query(args)
        },
      },
    },
  })

  return extended as unknown as PrismaClient
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? createPrisma()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

async function connectWithRetry(maxRetries = 5, delayMs = 3000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.$connect()
      logger.info('Database connected successfully')
      return
    } catch (error: any) {
      logger.warn({ err: error, attempt, maxRetries }, `Database connection attempt ${attempt}/${maxRetries} failed, retrying...`)
      if (attempt === maxRetries) {
        logger.error({ err: error }, 'Failed to connect to database after all retries')
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, delayMs * attempt))
    }
  }
}

connectWithRetry()

process.on('beforeExit', async () => {
  await prisma.$disconnect()
})

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return true
  } catch {
    return false
  }
}
