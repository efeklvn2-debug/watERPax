import { Router } from 'express'
import { productsController } from './controller'
import { validateRequest } from '../../middleware/validation'
import { authenticate, loadUser, requirePermission } from '../../middleware/auth'
import { tenantMiddleware, requireTenantUser } from '../../middleware/tenant'
import {
  createProductSchema, updateProductSchema,
  createVariantSchema, updateVariantSchema, replaceBomSchema
} from './validation'

export const productsRouter = Router()

productsRouter.use(authenticate, loadUser, requireTenantUser, tenantMiddleware)

productsRouter.get('/', requirePermission('product:read'), productsController.list)
productsRouter.post('/', requirePermission('product:write'), validateRequest(createProductSchema), productsController.create)
productsRouter.get('/:id', requirePermission('product:read'), productsController.get)
productsRouter.patch('/:id', requirePermission('product:write'), validateRequest(updateProductSchema), productsController.update)
productsRouter.post('/:productId/variants', requirePermission('product:write'), validateRequest(createVariantSchema), productsController.createVariant)
productsRouter.patch('/variants/:variantId', requirePermission('product:write'), validateRequest(updateVariantSchema), productsController.updateVariant)
productsRouter.get('/variants/:variantId/bom', requirePermission('product:read'), productsController.getBom)
productsRouter.put('/variants/:variantId/bom', requirePermission('product:write'), validateRequest(replaceBomSchema), productsController.replaceBom)
