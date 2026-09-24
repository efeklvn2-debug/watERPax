import { Request, Response, NextFunction } from 'express'
import { prisma } from '../database'
import { createChildLogger } from '../logger'

const logger = createChildLogger('honeypot')

const HONEYPOT_PATHS = [
  '/wp-admin', '/wp-login', '/wp-content', '/xmlrpc',
  '/phpmyadmin', '/pma', '/myadmin',
  '/backup', '/dump', '/db', '/database',
  '/.env', '/env', '/config', '/configuration',
  '/api/admin', '/api/swagger', '/swagger', '/openapi', '/api-docs',
  '/console', '/shell', '/terminal', '/cmd',
  '/test', '/tests', '/debug',
  '/.git', '/git', '/svn',
  '/actuator', '/management', '/monitoring',
  '/vendor', '/composer', '/artisan',
  '/cgi-bin', '/cgi',
  '/server-status', '/server-info'
]

export async function honeypotMiddleware(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown'

  try {
    const blocked = await prisma.blockedIp.findUnique({ where: { id: ip } })
    if (blocked) {
      logger.warn({ ip, path: req.path }, 'Blocked IP attempted request')
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } })
      return
    }
  } catch {
    next()
    return
  }

  const path = req.path.toLowerCase()
  let matchedPath: string | null = null

  for (const honeypotPath of HONEYPOT_PATHS) {
    if (path.startsWith(honeypotPath)) {
      matchedPath = honeypotPath
      break
    }
  }

  if (matchedPath) {
    logger.warn({
      ip,
      path: req.path,
      method: req.method,
      userAgent: req.headers['user-agent'] || 'unknown',
      matchedHoneypot: matchedPath
    }, 'Honeypot triggered — blocking IP')

    try {
      await prisma.blockedIp.create({
        data: { id: ip, reason: `honeypot: ${matchedPath}` }
      })
    } catch {
      // Race: already blocked by another request — fine
    }

    res.status(200).json({ status: 'ok' })
    return
  }

  next()
}
