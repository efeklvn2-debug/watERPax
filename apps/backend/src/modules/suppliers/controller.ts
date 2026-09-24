import { Request, Response, NextFunction } from 'express'
import { supplierService } from './service'
import { sendError } from '../../middleware/errorHandler'
import { auditService } from '../audit'

export const supplierController = {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const suppliers = await supplierService.getAll()
      res.json({ data: suppliers })
    } catch (error) { sendError(res, error, 'suppliers.getAll') }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const supplier = await supplierService.getById(req.params.id)
      res.json({ data: supplier })
    } catch (error) { sendError(res, error, 'suppliers.getById') }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, email, phone, address, notes } = req.body
      const supplier = await supplierService.create({ name, email, phone, address, notes })
      auditService.record({
        userId: (req as any).user?.id,
        action: 'supplier.create',
        entityType: 'Supplier',
        entityId: supplier.id,
        description: `Created supplier ${supplier.name}`,
        ipAddress: req.ip
      })
      res.status(201).json({ data: supplier })
    } catch (error) { sendError(res, error, 'suppliers.create') }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, email, phone, address, notes, isActive } = req.body
      const supplier = await supplierService.update(req.params.id, { name, email, phone, address, notes, isActive })
      auditService.record({
        userId: (req as any).user?.id,
        action: 'supplier.update',
        entityType: 'Supplier',
        entityId: req.params.id,
        description: `Updated supplier ${supplier.name}`,
        metadata: { fields: Object.keys(req.body) },
        ipAddress: req.ip
      })
      res.json({ data: supplier })
    } catch (error) { sendError(res, error, 'suppliers.update') }
  },

  async deactivate(req: Request, res: Response, next: NextFunction) {
    try {
      const supplier = await supplierService.deactivate(req.params.id)
      auditService.record({
        userId: (req as any).user?.id,
        action: 'supplier.deactivate',
        entityType: 'Supplier',
        entityId: req.params.id,
        description: `Deactivated supplier ${supplier.name}`,
        ipAddress: req.ip
      })
      res.json({ data: supplier })
    } catch (error) { sendError(res, error, 'suppliers.deactivate') }
  }
}
