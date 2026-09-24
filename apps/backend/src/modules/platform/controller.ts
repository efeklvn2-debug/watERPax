import { Request, Response } from 'express'
import { platformService } from './service'
import { sendError } from '../../middleware/errorHandler'

export const platformController = {
  async listTenants(req: Request, res: Response) {
    try {
      const tenants = await platformService.listTenants()
      res.json({ data: tenants })
    } catch (error) {
      sendError(res, error, 'platform.listTenants')
    }
  },

  async getTenant(req: Request, res: Response) {
    try {
      const tenant = await platformService.getTenant(req.params.id)
      res.json({ data: tenant })
    } catch (error) {
      sendError(res, error, 'platform.getTenant')
    }
  },

  async createTenant(req: Request, res: Response) {
    try {
      const tenant = await platformService.createTenant(req.body)
      res.status(201).json({ data: tenant })
    } catch (error) {
      sendError(res, error, 'platform.createTenant')
    }
  },

  async deleteTenant(req: Request, res: Response) {
    try {
      const result = await platformService.deleteTenant(req.params.id)
      res.json({ data: result })
    } catch (error) {
      sendError(res, error, 'platform.deleteTenant')
    }
  },

  async updateTenant(req: Request, res: Response) {
    try {
      const tenant = await platformService.updateTenant(req.params.id, req.body)
      res.json({ data: tenant })
    } catch (error) {
      sendError(res, error, 'platform.updateTenant')
    }
  },

  async createTenantUser(req: Request, res: Response) {
    try {
      const user = await platformService.createTenantUser(req.params.id, req.body)
      res.status(201).json({ data: user })
    } catch (error) {
      sendError(res, error, 'platform.createTenantUser')
    }
  },

  async deleteTenantUser(req: Request, res: Response) {
    try {
      const result = await platformService.deleteTenantUser(req.params.tenantId, req.params.userId)
      res.json({ data: result })
    } catch (error) {
      sendError(res, error, 'platform.deleteTenantUser')
    }
  },
}
