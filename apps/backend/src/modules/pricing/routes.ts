import { Router } from 'express'
import { pricingController } from './controller'
import { authenticate, loadUser, requirePermission } from '../../middleware/auth'
import { tenantMiddleware, requireTenantUser } from '../../middleware/tenant'

export const pricingRouter = Router()

pricingRouter.use(authenticate, loadUser, requireTenantUser, tenantMiddleware)

pricingRouter.get('/materials-prices', requirePermission('pricing:read'), pricingController.getMaterialsWithPrices)
pricingRouter.get('/', requirePermission('pricing:read'), pricingController.getPriceLists)
pricingRouter.post('/', requirePermission('pricing:write'), pricingController.createPriceList)
pricingRouter.patch('/:id', requirePermission('pricing:write'), pricingController.updatePriceList)
pricingRouter.delete('/:id', requirePermission('pricing:write'), pricingController.deletePriceList)
