import { Router } from 'express'
import { taxController } from './controller'
import { authenticate, loadUser, requirePermission } from '../../middleware/auth'
import { tenantMiddleware, requireTenantUser } from '../../middleware/tenant'
import { validateRequest } from '../../middleware/validation'
import { reportLimiter, mutationLimiter, sensitiveLimiter } from '../../middleware/rateLimiters'
import { postProvisionSchema, postPayeSchema, taxSettingsSchema } from './validation'

export const taxRouter = Router()

taxRouter.use(authenticate, loadUser, requireTenantUser, tenantMiddleware)

taxRouter.get('/summary', reportLimiter, requirePermission('tax:manage'), taxController.getTaxSummary)
taxRouter.get('/cit', reportLimiter, requirePermission('tax:manage'), taxController.getCitProvision)
taxRouter.post('/provision', mutationLimiter, requirePermission('tax:manage'), validateRequest(postProvisionSchema), taxController.postCitProvision)
taxRouter.get('/paye', reportLimiter, requirePermission('tax:manage'), taxController.getPayeEntries)
taxRouter.post('/paye', mutationLimiter, requirePermission('tax:manage'), validateRequest(postPayeSchema), taxController.addPayeEntry)
taxRouter.delete('/paye/:id', sensitiveLimiter, requirePermission('tax:manage'), taxController.deletePayeEntry)
taxRouter.get('/filing-pack', reportLimiter, requirePermission('tax:manage'), taxController.getFilingPack)

taxRouter.get('/settings', requirePermission('tax:manage'), taxController.getSettings)
taxRouter.patch('/settings', requirePermission('settings:write'), validateRequest(taxSettingsSchema), taxController.updateSettings)
