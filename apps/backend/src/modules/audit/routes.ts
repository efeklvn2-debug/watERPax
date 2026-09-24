import { Router } from 'express'
import { auditController } from './controller'
import { authenticate, loadUser, requirePermission } from '../../middleware/auth'
import { tenantMiddleware, requireTenantUser } from '../../middleware/tenant'
import { reportLimiter } from '../../middleware/rateLimiters'

export const auditRouter = Router()

auditRouter.use(reportLimiter)
auditRouter.use(authenticate)
auditRouter.use(loadUser)
auditRouter.use(requireTenantUser)
auditRouter.use(tenantMiddleware)
auditRouter.use(requirePermission('audit:read'))

auditRouter.get('/', auditController.list)
auditRouter.get('/actions', auditController.distinctActions)
auditRouter.get('/entity-types', auditController.distinctEntityTypes)
