import { Request, Response, NextFunction } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../database'
import { createChildLogger } from '../logger'
import { verifyToken } from '../auth'
import { getAccessTokenFromCookie } from '../cookies'

const logger = createChildLogger('idempotency')

const TTL_MS = 24 * 60 * 60 * 1000

/**
 * Tenant scope for the idempotency namespace. This middleware runs before
 * auth/tenant middleware, so there is no AsyncLocalStorage tenant context
 * yet — the scope is derived from the verified access token instead. The
 * JWT signature is always checked; missing/invalid tokens fall back to an
 * `anon` scope that can never collide with a tenant (`t:`) scope, so one
 * tenant's cached response is never replayed to another tenant sharing the
 * same client-chosen idempotency key.
 */
function getIdempotencyScope(req: Request): { scope: string; tenantId?: string } {
  try {
    const cookieToken = getAccessTokenFromCookie(req)
    const header = req.headers.authorization
    const token = cookieToken || (header?.startsWith('Bearer ') ? header.substring(7) : undefined)
    if (!token) return { scope: 'anon' }
    const payload = verifyToken(token)
    if (payload.tenantId) return { scope: `t:${payload.tenantId}`, tenantId: payload.tenantId }
    if (payload.userId) return { scope: `u:${payload.userId}` }
    return { scope: 'anon' }
  } catch {
    return { scope: 'anon' }
  }
}

export async function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const idempotencyKey = req.headers['idempotency-key'] as string

  if (!idempotencyKey) {
    next()
    return
  }

  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH' && req.method !== 'DELETE') {
    next()
    return
  }

  // Namespace the client-chosen key by tenant scope: two tenants sharing
  // the same `Idempotency-Key` header must never share a cache entry.
  const { scope, tenantId } = getIdempotencyScope(req)
  const namespacedKey = `${scope}:${idempotencyKey}`

  try {
    const existing = await prisma.idempotencyKey.findUnique({
      where: { id: namespacedKey }
    })

    if (existing) {
      if (Date.now() - existing.createdAt.getTime() > TTL_MS) {
        await prisma.idempotencyKey.delete({ where: { id: namespacedKey } })
        logger.info({ key: namespacedKey }, 'Expired idempotent key, allowing retry')
      } else {
        const cached = existing.response as any
        const statusCode = typeof cached?.statusCode === 'number' ? cached.statusCode : 200
        const body = cached?.statusCode ? cached.body : cached
        logger.info({ key: namespacedKey }, 'Returning cached response for idempotent request')
        res.status(statusCode).json(body)
        return
      }
    }

    const originalJson = res.json.bind(res)

    res.json = (async function (body: unknown) {
      const cachePayload = { statusCode: res.statusCode, body }
      try {
        await prisma.idempotencyKey.create({
          data: {
            id: namespacedKey,
            response: cachePayload as Prisma.InputJsonValue,
            ...(tenantId ? { tenantId } : {}),
          }
        })
      } catch (err) {
        if ((err as any)?.code === 'P2002') {
          logger.warn({ key: namespacedKey }, 'Duplicate idempotent key, response already cached')
        } else {
          logger.error({ err, key: namespacedKey }, 'Failed to cache idempotent response')
        }
      }
      return originalJson(body)
    }) as unknown as typeof res.json

    next()
  } catch (error) {
    logger.error({ err: error, key: namespacedKey }, 'Error in idempotency middleware')
    next(error)
  }
}
