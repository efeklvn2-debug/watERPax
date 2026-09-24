import { Request, Response } from 'express'
import { customersService } from './service'
import { AuthenticatedRequest } from '../../middleware/auth'
import { sendError } from '../../middleware/errorHandler'
import { auditService } from '../audit'
import { CreateCustomerInput, UpdateCustomerInput, RecordJarReturnInput } from './validation'

export const customersController = {
  async list(req: Request, res: Response) {
    try {
      res.json({ data: await customersService.list(req.query.includeInactive === 'true') })
    } catch (error) {
      sendError(res, error, 'customers.list')
    }
  },

  async get(req: Request, res: Response) {
    try {
      res.json({ data: await customersService.get(req.params.id) })
    } catch (error) {
      sendError(res, error, 'customers.get')
    }
  },

  async create(req: AuthenticatedRequest, res: Response) {
    try {
      const customer = await customersService.create(req.body as CreateCustomerInput)
      auditService.record({
        userId: req.user?.id,
        action: 'customer.create',
        entityType: 'Customer',
        entityId: customer.id,
        description: `Created customer ${(customer as any).code} ${(customer as any).name}`,
        ipAddress: req.ip
      })
      res.status(201).json({ data: customer })
    } catch (error) {
      sendError(res, error, 'customers.create')
    }
  },

  async update(req: AuthenticatedRequest, res: Response) {
    try {
      const customer = await customersService.update(req.params.id, req.body as UpdateCustomerInput)
      auditService.record({
        userId: req.user?.id,
        action: 'customer.update',
        entityType: 'Customer',
        entityId: customer.id,
        description: `Updated customer ${(customer as any).code}`,
        ipAddress: req.ip
      })
      res.json({ data: customer })
    } catch (error) {
      sendError(res, error, 'customers.update')
    }
  },

  async deactivate(req: AuthenticatedRequest, res: Response) {
    try {
      const customer = await customersService.deactivate(req.params.id)
      auditService.record({
        userId: req.user?.id,
        action: 'customer.deactivate',
        entityType: 'Customer',
        entityId: customer.id,
        description: `Deactivated customer ${(customer as any).code}`,
        ipAddress: req.ip
      })
      res.json({ data: customer })
    } catch (error) {
      sendError(res, error, 'customers.deactivate')
    }
  },

  async balance(req: Request, res: Response) {
    try {
      res.json({ data: await customersService.balance(req.params.id) })
    } catch (error) {
      sendError(res, error, 'customers.balance')
    }
  },

  async transactions(req: Request, res: Response) {
    try {
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 100
      res.json({ data: await customersService.transactions(req.params.id, Number.isFinite(limit) ? limit : 100) })
    } catch (error) {
      sendError(res, error, 'customers.transactions')
    }
  },

  async allBalances(req: Request, res: Response) {
    try {
      res.json({ data: await customersService.allBalances() })
    } catch (error) {
      sendError(res, error, 'customers.allBalances')
    }
  },

  async recordJarReturn(req: AuthenticatedRequest, res: Response) {
    try {
      const result = await customersService.recordJarReturn(req.params.id, req.body as RecordJarReturnInput)
      auditService.record({
        userId: req.user?.id,
        action: 'customer.jar_return',
        entityType: 'Customer',
        entityId: req.params.id,
        description: `Recorded ${result.quantity} empty jar(s) returned`,
        ipAddress: req.ip
      })
      res.json({ data: result })
    } catch (error) {
      sendError(res, error, 'customers.recordJarReturn')
    }
  }
}
