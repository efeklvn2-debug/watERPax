import { Request, Response } from 'express'
import { reportsService } from './service'
import { waterReportsService, runWaterReport, toCsv, WaterReportName } from './waterReports'
import { sendError } from '../../middleware/errorHandler'

function sendReport(res: Response, name: string, result: { rows: Record<string, string | number>[]; totals: Record<string, string | number>; meta: Record<string, unknown> }, format?: string) {
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`)
    res.send(toCsv(result.rows))
    return
  }
  res.json({ data: result })
}

export const reportsController = {
  async getAgingReceivables(req: Request, res: Response) {
    try {
      const { asOf } = req.query
      const data = await reportsService.getAgingReceivables(asOf as string)
      res.json({ data })
    } catch (error: any) {
      sendError(res, error, 'reports.getAgingReceivables')
    }
  },

  async getAgingPayables(req: Request, res: Response) {
    try {
      const { asOf } = req.query
      const data = await reportsService.getAgingPayables(asOf as string)
      res.json({ data })
    } catch (error: any) {
      sendError(res, error, 'reports.getAgingPayables')
    }
  },

  async getSalesByCustomer(req: Request, res: Response) {
    try {
      const { from, to } = req.query
      const data = await reportsService.getSalesByCustomer(from as string, to as string)
      res.json({ data })
    } catch (error: any) {
      sendError(res, error, 'reports.getSalesByCustomer')
    }
  },

  async getSalesByProduct(req: Request, res: Response) {
    try {
      const { from, to } = req.query
      const data = await reportsService.getSalesByProduct(from as string, to as string)
      res.json({ data })
    } catch (error: any) {
      sendError(res, error, 'reports.getSalesByProduct')
    }
  },

  async getInventoryMovements(req: Request, res: Response) {
    try {
      const { from, to } = req.query
      const data = await reportsService.getInventoryMovements(from as string, to as string)
      res.json({ data })
    } catch (error: any) {
      sendError(res, error, 'reports.getInventoryMovements')
    }
  },

  async getProfitRange(req: Request, res: Response) {
    try {
      const { from, to } = req.query
      const data = await reportsService.getProfitRange(from as string, to as string)
      res.json({ data })
    } catch (error: any) {
      sendError(res, error, 'reports.getProfitRange')
    }
  },

  async getBalanceSheet(req: Request, res: Response) {
    try {
      const { asOf } = req.query
      const data = await reportsService.getBalanceSheet(asOf as string)
      res.json({ data })
    } catch (error: any) {
      sendError(res, error, 'reports.getBalanceSheet')
    }
  },

  async getInventoryGLReconciliation(req: Request, res: Response) {
    try {
      const { asOf } = req.query
      const data = await reportsService.getInventoryGLReconciliation(asOf as string)
      res.json({ data })
    } catch (error: any) {
      sendError(res, error, 'reports.getInventoryGLReconciliation')
    }
  },

  async getBankMovements(req: Request, res: Response) {
    try {
      const { from, to, accountCode } = req.query
      const data = await reportsService.getBankMovements(from as string, to as string, accountCode as string)
      res.json({ data })
    } catch (error: any) {
      sendError(res, error, 'reports.getBankMovements')
    }
  },

  // --- Water (MTS) reports + dashboard. `?format=csv` downloads CSV. ---
  async waterReport(req: Request, res: Response) {
    try {
      const valid = ['fg-valuation', 'fg-grouped', 'production-output', 'waste', 'variance', 'sales-by-sku', 'low-raw']
      if (!valid.includes(req.params.name)) {
        res.status(400).json({ error: { code: 'UNKNOWN_REPORT', message: `Unknown report '${req.params.name}'` } })
        return
      }
      const { from, to, format, category, productId, variantId } = req.query
      const data = await runWaterReport(
        req.params.name as WaterReportName,
        { from: from as string | undefined, to: to as string | undefined, category: category as string | undefined, productId: productId as string | undefined, variantId: variantId as string | undefined }
      )
      sendReport(res, `water-${req.params.name}`, data, format as string | undefined)
    } catch (error: any) {
      sendError(res, error, 'reports.waterReport')
    }
  },

  async dashboard(req: Request, res: Response) {
    try {
      res.json({ data: await waterReportsService.dashboard() })
    } catch (error: any) {
      sendError(res, error, 'reports.dashboard')
    }
  }
}
