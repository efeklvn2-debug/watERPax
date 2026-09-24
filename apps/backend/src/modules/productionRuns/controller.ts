import { Request, Response } from 'express'
import { productionRunsService } from './service'
import { AuthenticatedRequest } from '../../middleware/auth'
import { sendError } from '../../middleware/errorHandler'
import { auditService } from '../audit'
import { CreateRunInput, CompleteRunInput, CancelRunInput } from './validation'

export const productionRunsController = {
  async list(req: Request, res: Response) {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined
      res.json({ data: await productionRunsService.list(status) })
    } catch (error) {
      sendError(res, error, 'productionRuns.list')
    }
  },

  async get(req: Request, res: Response) {
    try {
      res.json({ data: await productionRunsService.get(req.params.id) })
    } catch (error) {
      sendError(res, error, 'productionRuns.get')
    }
  },

  async create(req: AuthenticatedRequest, res: Response) {
    try {
      const run = await productionRunsService.create(req.body as CreateRunInput, req.user?.id)
      auditService.record({
        userId: req.user?.id,
        action: 'production_run.create',
        entityType: 'ProductionRun',
        entityId: (run as any).id,
        description: `Planned run ${(run as any).runNumber} (${(run as any).plannedPacks} packs)`,
        ipAddress: req.ip
      })
      res.status(201).json({ data: run })
    } catch (error) {
      sendError(res, error, 'productionRuns.create')
    }
  },

  async start(req: AuthenticatedRequest, res: Response) {
    try {
      res.json({ data: await productionRunsService.start(req.params.id, req.user?.id) })
    } catch (error) {
      sendError(res, error, 'productionRuns.start')
    }
  },

  async complete(req: AuthenticatedRequest, res: Response) {
    try {
      const result = await productionRunsService.complete(req.params.id, req.body as CompleteRunInput, req.user?.id)
      res.json({ data: result })
    } catch (error) {
      sendError(res, error, 'productionRuns.complete')
    }
  },

  async cancel(req: AuthenticatedRequest, res: Response) {
    try {
      const body = req.body as CancelRunInput
      res.json({ data: await productionRunsService.cancel(req.params.id, body?.reason, req.user?.id) })
    } catch (error) {
      sendError(res, error, 'productionRuns.cancel')
    }
  }
}
