import { Request, Response } from 'express'
import { productsService } from './service'
import { AuthenticatedRequest } from '../../middleware/auth'
import { sendError } from '../../middleware/errorHandler'
import { auditService } from '../audit'
import {
  CreateProductInput, UpdateProductInput,
  CreateVariantInput, UpdateVariantInput, ReplaceBomInput
} from './validation'

export const productsController = {
  async list(req: Request, res: Response) {
    try {
      const products = await productsService.listProducts(req.query.includeInactive === 'true')
      res.json({ data: products })
    } catch (error) {
      sendError(res, error, 'products.list')
    }
  },

  async get(req: Request, res: Response) {
    try {
      res.json({ data: await productsService.getProduct(req.params.id) })
    } catch (error) {
      sendError(res, error, 'products.get')
    }
  },

  async create(req: AuthenticatedRequest, res: Response) {
    try {
      const product = await productsService.createProduct(req.body as CreateProductInput)
      auditService.record({
        userId: req.user?.id,
        action: 'product.create',
        entityType: 'Product',
        entityId: product.id,
        description: `Created product ${product.code} ${product.name}`,
        ipAddress: req.ip
      })
      res.status(201).json({ data: product })
    } catch (error) {
      sendError(res, error, 'products.create')
    }
  },

  async update(req: AuthenticatedRequest, res: Response) {
    try {
      const product = await productsService.updateProduct(req.params.id, req.body as UpdateProductInput)
      auditService.record({
        userId: req.user?.id,
        action: 'product.update',
        entityType: 'Product',
        entityId: product.id,
        description: `Updated product ${product.code}`,
        ipAddress: req.ip
      })
      res.json({ data: product })
    } catch (error) {
      sendError(res, error, 'products.update')
    }
  },

  async createVariant(req: AuthenticatedRequest, res: Response) {
    try {
      const variant = await productsService.createVariant(req.params.productId, req.body as CreateVariantInput)
      auditService.record({
        userId: req.user?.id,
        action: 'product.create_variant',
        entityType: 'ProductVariant',
        entityId: variant.id,
        description: `Created variant '${(variant as any).label}' for product ${req.params.productId}`,
        ipAddress: req.ip
      })
      res.status(201).json({ data: variant })
    } catch (error) {
      sendError(res, error, 'products.createVariant')
    }
  },

  async updateVariant(req: AuthenticatedRequest, res: Response) {
    try {
      const variant = await productsService.updateVariant(req.params.variantId, req.body as UpdateVariantInput)
      auditService.record({
        userId: req.user?.id,
        action: 'product.update_variant',
        entityType: 'ProductVariant',
        entityId: variant.id,
        description: `Updated variant '${(variant as any).label}'`,
        ipAddress: req.ip
      })
      res.json({ data: variant })
    } catch (error) {
      sendError(res, error, 'products.updateVariant')
    }
  },

  async getBom(req: Request, res: Response) {
    try {
      res.json({ data: await productsService.getBom(req.params.variantId) })
    } catch (error) {
      sendError(res, error, 'products.getBom')
    }
  },

  async replaceBom(req: AuthenticatedRequest, res: Response) {
    try {
      const lines = await productsService.replaceBom(req.params.variantId, req.body as ReplaceBomInput)
      auditService.record({
        userId: req.user?.id,
        action: 'product.replace_bom',
        entityType: 'ProductVariant',
        entityId: req.params.variantId,
        description: `Replaced BOM (${lines.length} lines) for variant ${req.params.variantId}`,
        ipAddress: req.ip
      })
      res.json({ data: lines })
    } catch (error) {
      sendError(res, error, 'products.replaceBom')
    }
  }
}
