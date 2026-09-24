import { Request, Response, NextFunction } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../database'
import { createChildLogger } from '../logger'

const logger = createChildLogger('idempotency')

const TTL_MS = 24 * 60 * 60 * 1000

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

  try {
    const existing = await prisma.idempotencyKey.findUnique({
      where: { id: idempotencyKey }
    })

    if (existing) {
      if (Date.now() - existing.createdAt.getTime() > TTL_MS) {
        await prisma.idempotencyKey.delete({ where: { id: idempotencyKey } })
        logger.info({ key: idempotencyKey }, 'Expired idempotent key, allowing retry')
      } else {
        const cached = existing.response as any
        const statusCode = typeof cached?.statusCode === 'number' ? cached.statusCode : 200
        const body = cached?.statusCode ? cached.body : cached
        logger.info({ key: idempotencyKey }, 'Returning cached response for idempotent request')
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
            id: idempotencyKey,
            response: cachePayload as Prisma.InputJsonValue
          }
        })
      } catch (err) {
        if ((err as any)?.code === 'P2002') {
          logger.warn({ key: idempotencyKey }, 'Duplicate idempotent key, response already cached')
        } else {
          logger.error({ err, key: idempotencyKey }, 'Failed to cache idempotent response')
        }
      }
      return originalJson(body)
    }) as unknown as typeof res.json

    next()
  } catch (error) {
    logger.error({ err: error, key: idempotencyKey }, 'Error in idempotency middleware')
    next(error)
  }
}
