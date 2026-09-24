import { Router } from 'express'
import { authenticate, loadUser, requirePermission } from '../../middleware/auth'
import { tenantMiddleware, requireTenantUser } from '../../middleware/tenant'
import { supplierController } from './controller'

export const supplierRouter = Router()

supplierRouter.use(authenticate)
supplierRouter.use(loadUser)
supplierRouter.use(requireTenantUser)
supplierRouter.use(tenantMiddleware)

supplierRouter.get('/', requirePermission('supplier:read'), supplierController.getAll)
supplierRouter.get('/:id', requirePermission('supplier:read'), supplierController.getById)
supplierRouter.post('/', requirePermission('supplier:create'), supplierController.create)
supplierRouter.patch('/:id', requirePermission('supplier:edit'), supplierController.update)
supplierRouter.patch('/:id/deactivate', requirePermission('supplier:edit'), supplierController.deactivate)
supplierRouter.delete('/:id', requirePermission('supplier:edit'), supplierController.deactivate)
