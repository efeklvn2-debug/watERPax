import { Request, Response, NextFunction } from 'express'
import { taxService } from './service'
import { sendError } from '../../middleware/errorHandler'

export const taxController = {
  async getTaxSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear()
      const summary = await taxService.getTaxSummary(year)
      res.json({ data: summary })
    } catch (error) { sendError(res, error, 'tax.getTaxSummary') }
  },

  async getCitProvision(req: Request, res: Response, next: NextFunction) {
    try {
      const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear()
      const result = await taxService.getCitProvision(year)
      res.json({ data: result })
    } catch (error) { sendError(res, error, 'tax.getCitProvision') }
  },

  async postCitProvision(req: Request, res: Response, next: NextFunction) {
    try {
      const { year } = req.body
      const userId = (req as any).user?.id
      const result = await taxService.postCitProvision(year, userId)
      res.status(201).json({ data: result })
    } catch (error) { sendError(res, error, 'tax.postCitProvision') }
  },

  async getPayeEntries(req: Request, res: Response, next: NextFunction) {
    try {
      const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear()
      const entries = await taxService.getPayeEntries(year)
      res.json({ data: entries })
    } catch (error) { sendError(res, error, 'tax.getPayeEntries') }
  },

  async addPayeEntry(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?.id
      const entry = await taxService.addPayeEntry(req.body, userId)
      res.status(201).json({ data: entry })
    } catch (error) { sendError(res, error, 'tax.addPayeEntry') }
  },

  async deletePayeEntry(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params
      await taxService.deletePayeEntry(id)
      res.status(204).send()
    } catch (error) { sendError(res, error, 'tax.deletePayeEntry') }
  },

  async getFilingPack(req: Request, res: Response, next: NextFunction) {
    try {
      const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear()
      const pack = await taxService.getFilingPack(year)
      res.json({ data: pack })
    } catch (error) { sendError(res, error, 'tax.getFilingPack') }
  },

  async getSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const settings = await taxService.getSettings()
      res.json({ data: settings })
    } catch (error) { sendError(res, error, 'tax.getSettings') }
  },

  async updateSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const settings = await taxService.updateSettings(req.body)
      res.json({ data: settings })
    } catch (error) { sendError(res, error, 'tax.updateSettings') }
  },
}
