import { Router } from 'express'
import { authenticate, loadUser, requirePermission } from '../../middleware/auth'
import { tenantMiddleware } from '../../middleware/tenant'
import { validateRequest } from '../../middleware/validation'
import { guideAngelController } from './controller'
import { guideAngelCompleteSchema, guideAngelSaveSchema } from './validation'
import { AppError } from '../../middleware/errorHandler'

function requireTenantAdmin(req: any, res: any, next: any) {
  if (req.user?.role === 'SUPER_ADMIN') {
    return next(new AppError(403, 'FORBIDDEN', 'Use the selected tenant support route for assisted setup'))
  }
  if (req.user?.role !== 'ADMIN') {
    return next(new AppError(403, 'FORBIDDEN', 'Only a tenant administrator can complete Guide Angel'))
  }
  next()
}

export const guideAngelRouter = Router()

guideAngelRouter.use(authenticate, loadUser, requireTenantAdmin, tenantMiddleware, requirePermission('auth:manage_users'))
guideAngelRouter.get('/data', guideAngelController.data)
guideAngelRouter.get('/', guideAngelController.get)
guideAngelRouter.post('/save', validateRequest(guideAngelSaveSchema), guideAngelController.save)
guideAngelRouter.post('/validate', validateRequest(guideAngelSaveSchema), guideAngelController.validate)
guideAngelRouter.post('/complete', validateRequest(guideAngelCompleteSchema), guideAngelController.complete)
