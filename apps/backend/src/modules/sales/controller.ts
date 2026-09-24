import { Request, Response } from 'express'
import { salesService } from './service'
import { AuthenticatedRequest, checkUserPermission } from '../../middleware/auth'
import { sendError } from '../../middleware/errorHandler'
import { auditService } from '../audit'
import { CreateSaleInput, UpdateLinePriceInput, DeliverSaleInput, RecordPaymentInput, RecordDepositInput, CancelSaleInput, CustomerCreditNoteInput } from './validation'

async function canDiscount(req: AuthenticatedRequest): Promise<boolean> {
  if (!req.user) return false
  return checkUserPermission(req.user.id, req.user.role, 'sales:discount' as any)
}

export const salesController = {
  async list(req: Request, res: Response) {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined
      const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : undefined
      res.json({ data: await salesService.list(status, customerId) })
    } catch (error) {
      sendError(res, error, 'sales.list')
    }
  },

  async get(req: Request, res: Response) {
    try {
      res.json({ data: await salesService.get(req.params.id) })
    } catch (error) {
      sendError(res, error, 'sales.get')
    }
  },

  async create(req: AuthenticatedRequest, res: Response) {
    try {
      const sale = await salesService.create(req.body as CreateSaleInput, {
        userId: req.user?.id,
        canDiscount: await canDiscount(req)
      })
      auditService.record({
        userId: req.user?.id,
        action: 'sale.create',
        entityType: 'Sale',
        entityId: (sale as any).id,
        description: `Created sale ${(sale as any).saleNumber}`,
        ipAddress: req.ip
      })
      res.status(201).json({ data: sale })
    } catch (error) {
      sendError(res, error, 'sales.create')
    }
  },

  async updateLinePrice(req: AuthenticatedRequest, res: Response) {
    try {
      const body = req.body as UpdateLinePriceInput
      const sale = await salesService.updateLinePrice(
        req.params.id,
        req.params.lineId,
        body.unitPrice,
        await canDiscount(req)
      )
      auditService.record({
        userId: req.user?.id,
        action: 'sale.discount',
        entityType: 'Sale',
        entityId: req.params.id,
        description: `Price set to ${body.unitPrice} on line ${req.params.lineId}`,
        ipAddress: req.ip
      })
      res.json({ data: sale })
    } catch (error) {
      sendError(res, error, 'sales.updateLinePrice')
    }
  },

  async confirm(req: AuthenticatedRequest, res: Response) {
    try {
      res.json({ data: await salesService.confirm(req.params.id, req.user?.id) })
    } catch (error) {
      sendError(res, error, 'sales.confirm')
    }
  },

  async deliver(req: AuthenticatedRequest, res: Response) {
    try {
      const result = await salesService.deliver(req.params.id, (req.body || {}) as DeliverSaleInput, {
        userId: req.user?.id
      })
      res.json({ data: result })
    } catch (error) {
      sendError(res, error, 'sales.deliver')
    }
  },

  async recordPayment(req: AuthenticatedRequest, res: Response) {
    try {
      const result = await salesService.recordPayment(req.params.id, req.body as RecordPaymentInput, req.user?.id)
      res.status(201).json({ data: result })
    } catch (error) {
      sendError(res, error, 'sales.recordPayment')
    }
  },

  async complete(req: AuthenticatedRequest, res: Response) {
    try {
      res.json({ data: await salesService.complete(req.params.id, req.user?.id) })
    } catch (error) {
      sendError(res, error, 'sales.complete')
    }
  },

  async cancel(req: AuthenticatedRequest, res: Response) {
    try {
      const body = (req.body || {}) as CancelSaleInput
      res.json({ data: await salesService.cancel(req.params.id, body?.reason, req.user?.id) })
    } catch (error) {
      sendError(res, error, 'sales.cancel')
    }
  },

  async receiptData(req: Request, res: Response) {
    try {
      res.json({ data: await salesService.receiptData(req.params.id) })
    } catch (error) {
      sendError(res, error, 'sales.receiptData')
    }
  },

  async downloadInvoicePdf(req: Request, res: Response) {
    try {
      const { generateInvoicePdf } = await import('./pdf-service')
      const buffer = await generateInvoicePdf(req.params.invoiceId)
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="invoice-${req.params.invoiceId}.pdf"`)
      res.send(Buffer.from(buffer))
    } catch (error) {
      sendError(res, error, 'sales.downloadInvoicePdf')
    }
  },

  async downloadReceiptPdf(req: Request, res: Response) {
    try {
      const { generateReceiptPdf } = await import('./pdf-service')
      const buffer = await generateReceiptPdf(req.params.receiptId)
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="receipt-${req.params.receiptId}.pdf"`)
      res.send(Buffer.from(buffer))
    } catch (error) {
      sendError(res, error, 'sales.downloadReceiptPdf')
    }
  },

  async listInvoices(req: Request, res: Response) {
    try {
      const { status, customerId, dateFrom, dateTo } = req.query
      res.json({ data: await salesService.listInvoices({
        status: typeof status === 'string' ? status : undefined,
        customerId: typeof customerId === 'string' ? customerId : undefined,
        dateFrom: typeof dateFrom === 'string' ? dateFrom : undefined,
        dateTo: typeof dateTo === 'string' ? dateTo : undefined
      }) })
    } catch (error) {
      sendError(res, error, 'sales.listInvoices')
    }
  },

  async listPayments(req: Request, res: Response) {
    try {
      const { customerId, dateFrom, dateTo } = req.query
      res.json({ data: await salesService.listPayments({
        customerId: typeof customerId === 'string' ? customerId : undefined,
        dateFrom: typeof dateFrom === 'string' ? dateFrom : undefined,
        dateTo: typeof dateTo === 'string' ? dateTo : undefined
      }) })
    } catch (error) {
      sendError(res, error, 'sales.listPayments')
    }
  },

  async recordDeposit(req: AuthenticatedRequest, res: Response) {
    try {
      const result = await salesService.recordDeposit(req.body as RecordDepositInput, req.user?.id)
      res.status(201).json({ data: result })
    } catch (error) {
      sendError(res, error, 'sales.recordDeposit')
    }
  },

  async createCustomerCreditNote(req: AuthenticatedRequest, res: Response) {
    try {
      const note = await salesService.createCustomerCreditNote(req.body as CustomerCreditNoteInput, { userId: req.user?.id })
      res.status(201).json({ data: note })
    } catch (error) {
      sendError(res, error, 'sales.createCustomerCreditNote')
    }
  },

  async listCustomerCreditNotes(req: Request, res: Response) {
    try {
      const { customerId, saleId, dateFrom, dateTo } = req.query
      res.json({
        data: await salesService.getCustomerCreditNotes({
          customerId: typeof customerId === 'string' ? customerId : undefined,
          saleId: typeof saleId === 'string' ? saleId : undefined,
          dateFrom: typeof dateFrom === 'string' ? dateFrom : undefined,
          dateTo: typeof dateTo === 'string' ? dateTo : undefined
        })
      })
    } catch (error) {
      sendError(res, error, 'sales.listCustomerCreditNotes')
    }
  }
}
