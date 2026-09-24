import { Request, Response } from 'express'
import { auditService } from './service'
import { AuthenticatedRequest } from '../../middleware/auth'
import { sendError } from '../../middleware/errorHandler'

export const auditController = {
  async list(req: AuthenticatedRequest, res: Response) {
    try {
      const query = {
        userId: req.query.userId as string | undefined,
        action: req.query.action as string | undefined,
        entityType: req.query.entityType as string | undefined,
        entityId: req.query.entityId as string | undefined,
        dateFrom: req.query.dateFrom as string | undefined,
        dateTo: req.query.dateTo as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string) : undefined
      }
      const result = await auditService.list(query)
      res.status(200).json({ data: result })
    } catch (error) {
      sendError(res, error, 'audit.list')
    }
  },

  async distinctActions(_req: AuthenticatedRequest, res: Response) {
    try {
      const actions = await auditService.distinctActions()
      res.status(200).json({ data: actions })
    } catch (error) {
      sendError(res, error, 'audit.distinctActions')
    }
  },

  async distinctEntityTypes(_req: AuthenticatedRequest, res: Response) {
    try {
      const types = await auditService.distinctEntityTypes()
      res.status(200).json({ data: types })
    } catch (error) {
      sendError(res, error, 'audit.distinctEntityTypes')
    }
  }
}
