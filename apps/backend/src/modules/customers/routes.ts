import { Router } from 'express'
import { customersController } from './controller'
import { validateRequest } from '../../middleware/validation'
import { authenticate, loadUser, requirePermission } from '../../middleware/auth'
import { tenantMiddleware, requireTenantUser } from '../../middleware/tenant'
import { createCustomerSchema, updateCustomerSchema, recordJarReturnSchema } from './validation'

export const customersRouter = Router()

customersRouter.use(authenticate, loadUser, requireTenantUser, tenantMiddleware)

customersRouter.get('/', requirePermission('customer:read'), customersController.list)
customersRouter.get('/balances', requirePermission('customer:read'), customersController.allBalances)
customersRouter.post('/', requirePermission('customer:create'), validateRequest(createCustomerSchema), customersController.create)
customersRouter.get('/:id', requirePermission('customer:read'), customersController.get)
customersRouter.patch('/:id', requirePermission('customer:edit'), validateRequest(updateCustomerSchema), customersController.update)
customersRouter.patch('/:id/deactivate', requirePermission('customer:edit'), customersController.deactivate)
customersRouter.get('/:id/balance', requirePermission('customer:read'), customersController.balance)
customersRouter.get('/:id/transactions', requirePermission('customer:read'), customersController.transactions)
customersRouter.post('/:id/jar-return', requirePermission('customer:edit'), validateRequest(recordJarReturnSchema), customersController.recordJarReturn)
