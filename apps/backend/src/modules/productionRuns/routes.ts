import { Router } from 'express'
import { productionRunsController } from './controller'
import { validateRequest } from '../../middleware/validation'
import { authenticate, loadUser, requirePermission } from '../../middleware/auth'
import { tenantMiddleware, requireTenantUser } from '../../middleware/tenant'
import { createRunSchema, startRunSchema, completeRunSchema, cancelRunSchema } from './validation'

export const productionRunsRouter = Router()

productionRunsRouter.use(authenticate, loadUser, requireTenantUser, tenantMiddleware)

productionRunsRouter.get('/', requirePermission('production:read'), productionRunsController.list)
productionRunsRouter.post('/', requirePermission('production:plan'), validateRequest(createRunSchema), productionRunsController.create)
productionRunsRouter.get('/:id', requirePermission('production:read'), productionRunsController.get)
productionRunsRouter.post('/:id/start', requirePermission('production:plan'), validateRequest(startRunSchema), productionRunsController.start)
productionRunsRouter.post('/:id/complete', requirePermission('production:complete'), validateRequest(completeRunSchema), productionRunsController.complete)
productionRunsRouter.post('/:id/cancel', requirePermission('production:cancel'), validateRequest(cancelRunSchema), productionRunsController.cancel)
