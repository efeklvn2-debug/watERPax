import { Request, Response, NextFunction } from 'express'
import { inventoryService } from './service'
import { dateFromInput } from '../../utils/dates'
import { MaterialInput, StockMovementInput } from './validation'
import { AuthenticatedRequest } from '../../middleware/auth'
import { AppError, sendError } from '../../middleware/errorHandler'
import { auditService } from '../audit'

export const inventoryController = {
  async getSubCategories(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await inventoryService.getSubCategories()
      res.json({ data: result })
    } catch (error) {
      sendError(res, error, 'inventory.getSubCategories')
    }
  },

  async getAllMaterials(req: Request, res: Response, next: NextFunction) {
    try {
      const includeInactive = req.query.includeInactive === 'true'
      const materials = includeInactive
        ? await inventoryService.getAllMaterials()
        : await inventoryService.getMaterialsWithStock()
      res.json({ data: materials })
    } catch (error) {
      sendError(res, error, 'inventory.getAllMaterials')
    }
  },

  async getMaterialById(req: Request, res: Response, next: NextFunction) {
    try {
      const material = await inventoryService.getMaterialById(req.params.id)
      res.json({ data: material })
    } catch (error) {
      sendError(res, error, 'inventory.getMaterialById')
    }
  },

  async createMaterial(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const input = req.body as MaterialInput
      const userId = req.user?.id
      const material = await inventoryService.createMaterial(input, userId)
      auditService.record({
        userId,
        action: 'material.create',
        entityType: 'Material',
        entityId: material.id,
        description: `Created material ${material.code} ${material.name} (${material.category})`,
        ipAddress: req.ip
      })
      res.status(201).json({ data: material })
    } catch (error) {
      sendError(res, error, 'inventory.createMaterial')
    }
  },

  async updateMaterial(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const input = req.body as Partial<MaterialInput>
      const userId = req.user?.id
      const material = await inventoryService.updateMaterial(req.params.id, input, userId)
      auditService.record({
        userId,
        action: 'material.update',
        entityType: 'Material',
        entityId: req.params.id,
        description: `Updated material ${material.code} ${material.name}`,
        metadata: { fields: Object.keys(input) },
        ipAddress: req.ip
      })
      res.json({ data: material })
    } catch (error) {
      sendError(res, error, 'inventory.updateMaterial')
    }
  },

  async archiveMaterial(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const material = await inventoryService.archiveMaterial(req.params.id)
      auditService.record({
        userId: req.user?.id,
        action: 'material.archive',
        entityType: 'Material',
        entityId: req.params.id,
        description: `Archived material ${material.code} ${material.name}`,
        ipAddress: req.ip
      })
      res.json({ data: material })
    } catch (error) {
      sendError(res, error, 'inventory.archiveMaterial')
    }
  },

  async restoreMaterial(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const material = await inventoryService.restoreMaterial(req.params.id)
      auditService.record({
        userId: req.user?.id,
        action: 'material.restore',
        entityType: 'Material',
        entityId: req.params.id,
        description: `Restored material ${material.code} ${material.name}`,
        ipAddress: req.ip
      })
      res.json({ data: material })
    } catch (error) {
      sendError(res, error, 'inventory.restoreMaterial')
    }
  },

  async deleteMaterial(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await inventoryService.deleteMaterial(req.params.id)
      res.status(204).send()
    } catch (error) {
      sendError(res, error, 'inventory.deleteMaterial')
    }
  },

  async adjustStock(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { newQuantity, reason, date } = req.body
      const material = await inventoryService.adjustStock(req.params.id, newQuantity, reason, date)
      auditService.record({
        userId: req.user?.id,
        action: 'inventory.adjust_stock',
        entityType: 'Material',
        entityId: req.params.id,
        description: `Adjusted stock of ${material.code} ${material.name} to ${newQuantity}${reason ? ` — ${reason}` : ''}`,
        metadata: { newQuantity, reason },
        ipAddress: req.ip
      })
      res.json({ data: material })
    } catch (error) {
      sendError(res, error, 'inventory.adjustStock')
    }
  },

  async recordStockMovement(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const input = req.body as StockMovementInput
      const userId = req.user?.id
      const movement = await inventoryService.recordStockMovement(input, userId)
      res.status(201).json({ data: movement })
    } catch (error) {
      sendError(res, error, 'inventory.recordStockMovement')
    }
  },

  async getStockMovements(req: Request, res: Response, next: NextFunction) {
    try {
      const materialId = req.query.materialId as string | undefined
      const limit = parseInt(req.query.limit as string) || 50
      const movements = await inventoryService.getStockMovements(materialId, limit)
      res.json({ data: movements })
    } catch (error) {
      sendError(res, error, 'inventory.getStockMovements')
    }
  },

  async getPackingBagStock(req: Request, res: Response, next: NextFunction) {
    try {
      const days = parseInt(req.query.days as string) || 60
      const result = await inventoryService.getPackingBagStock(days)
      res.json({ data: result })
    } catch (error) {
      sendError(res, error, 'inventory.getPackingBagStock')
    }
  },
}
