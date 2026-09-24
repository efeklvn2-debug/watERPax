import { Router } from 'express'
import { platformController } from './controller'
import { validateRequest } from '../../middleware/validation'
import { authenticate, loadUser } from '../../middleware/auth'
import { requireSuperAdmin } from './middleware'
import { createTenantSchema, createTenantUserSchema, updateTenantSchema } from './validation'

export const platformRouter = Router()

platformRouter.use(authenticate, loadUser, requireSuperAdmin)

platformRouter.get('/tenants', platformController.listTenants)
platformRouter.get('/tenants/:id', platformController.getTenant)
platformRouter.post('/tenants', validateRequest(createTenantSchema), platformController.createTenant)
platformRouter.patch('/tenants/:id', validateRequest(updateTenantSchema), platformController.updateTenant)
platformRouter.delete('/tenants/:id', platformController.deleteTenant)
platformRouter.post('/tenants/:id/users', validateRequest(createTenantUserSchema), platformController.createTenantUser)
platformRouter.delete('/tenants/:tenantId/users/:userId', platformController.deleteTenantUser)
