import { Router } from 'express'
import { salesController } from './controller'
import { validateRequest } from '../../middleware/validation'
import { authenticate, loadUser, requirePermission } from '../../middleware/auth'
import { tenantMiddleware, requireTenantUser } from '../../middleware/tenant'
import {
  createSaleSchema, updateLinePriceSchema, deliverSaleSchema,
  recordPaymentSchema, recordDepositSchema, cancelSaleSchema, customerCreditNoteSchema
} from './validation'

export const salesRouter = Router()

salesRouter.use(authenticate, loadUser, requireTenantUser, tenantMiddleware)

// Collection routes (before /:id to avoid Express matching)
salesRouter.get('/invoices', requirePermission('sales:read'), salesController.listInvoices)
salesRouter.get('/payments', requirePermission('sales:read'), salesController.listPayments)
salesRouter.post('/deposits', requirePermission('sales:payment'), validateRequest(recordDepositSchema), salesController.recordDeposit)
salesRouter.get('/credit-notes', requirePermission('sales:read'), salesController.listCustomerCreditNotes)
salesRouter.post('/credit-notes', requirePermission('sales:return'), validateRequest(customerCreditNoteSchema), salesController.createCustomerCreditNote)

// Single-sale routes
salesRouter.get('/', requirePermission('sales:read'), salesController.list)
salesRouter.post('/', requirePermission('sales:create'), validateRequest(createSaleSchema), salesController.create)
salesRouter.get('/:id', requirePermission('sales:read'), salesController.get)
salesRouter.patch('/:id/lines/:lineId/price', requirePermission('sales:create'), validateRequest(updateLinePriceSchema), salesController.updateLinePrice)
salesRouter.post('/:id/confirm', requirePermission('sales:confirm'), salesController.confirm)
salesRouter.post('/:id/deliver', requirePermission('sales:deliver'), validateRequest(deliverSaleSchema), salesController.deliver)
salesRouter.post('/:id/payments', requirePermission('sales:payment'), validateRequest(recordPaymentSchema), salesController.recordPayment)
salesRouter.post('/:id/complete', requirePermission('sales:deliver'), salesController.complete)
salesRouter.post('/:id/cancel', requirePermission('sales:deliver'), salesController.cancel)
salesRouter.get('/:id/receipt', requirePermission('sales:read'), salesController.receiptData)
salesRouter.get('/invoices/:invoiceId/pdf', requirePermission('sales:read'), salesController.downloadInvoicePdf)
salesRouter.get('/receipts/:receiptId/pdf', requirePermission('sales:read'), salesController.downloadReceiptPdf)
