import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth'
import { sendError } from '../../middleware/errorHandler'
import { guideAngelService } from './service'

export const guideAngelController = {
  async data(req: AuthenticatedRequest, res: Response) {
    try {
      res.json({ data: await guideAngelService.getData() })
    } catch (error) {
      sendError(res, error, 'guideAngel.data')
    }
  },

  async get(req: AuthenticatedRequest, res: Response) {
    try {
      res.json({ data: await guideAngelService.getSession() })
    } catch (error) {
      sendError(res, error, 'guideAngel.get')
    }
  },

  async save(req: AuthenticatedRequest, res: Response) {
    try {
      res.json({ data: await guideAngelService.saveDraft(req.body.draft, req.user!.id) })
    } catch (error) {
      sendError(res, error, 'guideAngel.save')
    }
  },

  async validate(req: AuthenticatedRequest, res: Response) {
    try {
      res.json({ data: await guideAngelService.validateDraft(req.body.draft) })
    } catch (error) {
      sendError(res, error, 'guideAngel.validate')
    }
  },

  async complete(req: AuthenticatedRequest, res: Response) {
    try {
      res.json({ data: await guideAngelService.complete(req.user!.id) })
    } catch (error) {
      sendError(res, error, 'guideAngel.complete')
    }
  }
}
