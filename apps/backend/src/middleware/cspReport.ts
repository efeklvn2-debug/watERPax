import { Request, Response } from 'express'
import { prisma } from '../database'
import { logger } from '../logger'

const MAX_REPORT_BODY_BYTES = 64 * 1024
const MAX_FIELD_LENGTH = 500

export function cspReportHandler(req: Request, res: Response) {
  const contentLength = parseInt(String(req.headers['content-length'] || '0'), 10)
  if (!Number.isNaN(contentLength) && contentLength > MAX_REPORT_BODY_BYTES) {
    res.status(413).end()
    return
  }

  const body = req.body
  const report = body && typeof body === 'object' && body['csp-report'] ? body['csp-report'] : body

  if (!report || typeof report !== 'object' || Object.keys(report).length === 0) {
    res.status(204).end()
    return
  }

  const blockedUri = String(report['blocked-uri'] || 'unknown').slice(0, MAX_FIELD_LENGTH)
  const violatedDirective = String(report['violated-directive'] || 'unknown').slice(0, 200)
  const documentUri = String(report['document-uri'] || 'unknown').slice(0, MAX_FIELD_LENGTH)

  logger.warn({ blockedUri, violatedDirective, documentUri }, 'CSP violation reported')

  prisma.auditLog.create({
    data: {
      userId: null,
      tenantId: null,
      action: 'csp.report',
      entityType: 'csp',
      entityId: blockedUri,
      description: `CSP violation: ${violatedDirective} blocked ${blockedUri} (document: ${documentUri})`
    }
  }).catch((err) => {
    logger.warn({ err }, 'Failed to store CSP report')
  })

  res.status(204).end()
}