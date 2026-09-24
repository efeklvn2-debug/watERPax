import { Request, Response } from 'express'
import { pricingService, priceListSchema } from './service'
import { logger } from '../../logger'
import { sendError } from '../../middleware/errorHandler'

export const pricingController = {
  async getMaterialsWithPrices(req: Request, res: Response) {
    try {
      const includeInactive = req.query.includeInactive === 'true'
      const materials = await pricingService.getMaterialsWithPrices(includeInactive)
      res.json({ data: materials })
    } catch (error: any) {
      sendError(res, error, 'pricing.getMaterialsWithPrices')
    }
  },

  async getPriceLists(req: Request, res: Response) {
    try {
      const priceLists = await pricingService.getPriceLists()
      res.json({ data: priceLists })
    } catch (error: any) {
      sendError(res, error, 'pricing.getPriceLists')
    }
  },

  async createPriceList(req: Request, res: Response) {
    try {
      const parseResult = priceListSchema.safeParse(req.body)
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Validation failed', details: parseResult.error.issues })
      }
      
      const priceList = await pricingService.createPriceList(parseResult.data)
      res.status(201).json({ data: priceList })
    } catch (error: any) {
      sendError(res, error, 'pricing.createPriceList')
    }
  },

  async updatePriceList(req: Request, res: Response) {
    try {
      const { id } = req.params
      const parseResult = priceListSchema.partial().safeParse(req.body)
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Validation failed', details: parseResult.error.issues })
      }
      
      const priceList = await pricingService.updatePriceList(id, parseResult.data)
      res.json({ data: priceList })
    } catch (error: any) {
      sendError(res, error, 'pricing.updatePriceList')
    }
  },

  async deletePriceList(req: Request, res: Response) {
    try {
      const { id } = req.params
      await pricingService.deletePriceList(id)
      res.json({ success: true })
    } catch (error: any) {
      sendError(res, error, 'pricing.deletePriceList')
    }
  }
}
