import { Request, Response, NextFunction } from 'express'
import { settingsService } from './service'
import { sendError } from '../../middleware/errorHandler'
import { auditService } from '../audit'

export const settingsController = {
  async getSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const settings = await settingsService.getSettings()
      res.json({ data: settings })
    } catch (error) { sendError(res, error, 'settings.getSettings') }
  },

  async getOverheadRate(req: Request, res: Response, next: NextFunction) {
    try {
      const rate = await settingsService.getOverheadRate()
      res.json({ data: rate })
    } catch (error) { sendError(res, error, 'settings.getOverheadRate') }
  },

  async updateOverheadRate(req: Request, res: Response, next: NextFunction) {
    try {
      const { rate } = req.body
      const userId = (req as any).user?.id
      const updatedRate = await settingsService.updateOverheadRate(rate, userId)
      auditService.record({
        userId,
        action: 'settings.update_overhead_rate',
        entityType: 'Settings',
        entityId: null,
        description: `Updated overhead rate to ${rate}`,
        metadata: { rate },
        ipAddress: req.ip
      })
      res.json({ data: updatedRate })
    } catch (error) { sendError(res, error, 'settings.updateOverheadRate') }
  },

  async getOverheadRateHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const history = await settingsService.getOverheadRateHistory()
      res.json({ data: history })
    } catch (error) { sendError(res, error, 'settings.getOverheadRateHistory') }
  },

  async updateVatSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const input = req.body
      const settings = await settingsService.updateVatSettings(input)
      auditService.record({
        userId: (req as any).user?.id,
        action: 'settings.update_vat',
        entityType: 'Settings',
        entityId: null,
        description: 'Updated VAT settings',
        metadata: input,
        ipAddress: req.ip
      })
      res.json({ data: settings })
    } catch (error) { sendError(res, error, 'settings.updateVatSettings') }
  },

  async getInvoiceSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const settings = await settingsService.getInvoiceSettings()
      res.json({ data: settings })
    } catch (error) { sendError(res, error, 'settings.getInvoiceSettings') }
  },

  async updateInvoiceSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const input = req.body
      const settings = await settingsService.updateInvoiceSettings(input)
      res.json({ data: settings })
    } catch (error) { sendError(res, error, 'settings.updateInvoiceSettings') }
  },

  async updateBooksLocked(req: Request, res: Response, next: NextFunction) {
    try {
      const { booksLockedUntil } = req.body
      const result = await settingsService.updateBooksLockedUntil(booksLockedUntil)
      res.json({ data: result })
    } catch (error) { sendError(res, error, 'settings.updateBooksLocked') }
  },

  async updateTaxSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const input = req.body
      const settings = await settingsService.updateTaxSettings(input)
      auditService.record({
        userId: (req as any).user?.id,
        action: 'settings.update_tax',
        entityType: 'Settings',
        entityId: null,
        description: `Updated tax settings: CIT rate ${input.citRate}, filing frequency ${input.vatFilingFrequency}`,
        metadata: input,
        ipAddress: req.ip
      })
      res.json({ data: settings })
    } catch (error) { sendError(res, error, 'settings.updateTaxSettings') }
  },

  async updateJarMaterialCode(req: Request, res: Response, next: NextFunction) {
    try {
      const { jarMaterialCode } = req.body
      const result = await settingsService.updateJarMaterialCode(jarMaterialCode || null)
      auditService.record({
        userId: (req as any).user?.id,
        action: 'settings.update_jar_material_code',
        entityType: 'Settings',
        entityId: null,
        description: `Updated jar material code to ${jarMaterialCode || '(none)'}`,
        metadata: { jarMaterialCode },
        ipAddress: req.ip
      })
      res.json({ data: result })
    } catch (error) { sendError(res, error, 'settings.updateJarMaterialCode') }
  },
}
