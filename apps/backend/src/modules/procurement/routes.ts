import { Router } from 'express'
import { procurementController } from './controller'
import { authenticate, loadUser, requirePermission } from '../../middleware/auth'
import { tenantMiddleware, requireTenantUser } from '../../middleware/tenant'
import { validateRequest } from '../../middleware/validation'
import { mutationLimiter } from '../../middleware/rateLimiters'
import {
  purchaseOrderSchema, updatePOSchema, addLineItemSchema,
  receivePOSchema, supplierInvoiceSchema, supplierPaymentSchema, creditNoteSchema
} from './validation'

export const procurementRouter = Router()

procurementRouter.use(authenticate, loadUser, requireTenantUser, tenantMiddleware)

// Purchase Orders
procurementRouter.get('/purchase-orders', requirePermission('procurement:read'), procurementController.getAllPOs)
procurementRouter.get('/purchase-orders/:id', requirePermission('procurement:read'), procurementController.getPOById)
procurementRouter.post('/purchase-orders', requirePermission('procurement:create'), validateRequest(purchaseOrderSchema), procurementController.createPO)
procurementRouter.patch('/purchase-orders/:id', requirePermission('procurement:edit'), validateRequest(updatePOSchema), procurementController.updatePO)
procurementRouter.post('/purchase-orders/:id/items', requirePermission('procurement:edit'), validateRequest(addLineItemSchema), procurementController.addLineItem)
procurementRouter.delete('/purchase-orders/:id/items/:lineItemId', requirePermission('procurement:edit'), procurementController.removeLineItem)
procurementRouter.delete('/purchase-orders/:id', requirePermission('procurement:edit'), procurementController.deletePO)
procurementRouter.post('/purchase-orders/:id/receive', mutationLimiter, requirePermission('procurement:receive'), validateRequest(receivePOSchema), procurementController.receivePO)

// Supplier Invoices
procurementRouter.get('/supplier-invoices', requirePermission('procurement:read'), procurementController.getAllSupplierInvoices)
procurementRouter.get('/supplier-invoices/:id', requirePermission('procurement:read'), procurementController.getSupplierInvoiceById)
procurementRouter.post('/supplier-invoices', mutationLimiter, requirePermission('procurement:create'), validateRequest(supplierInvoiceSchema), procurementController.createSupplierInvoice)
procurementRouter.post('/supplier-invoices/:id/payments', mutationLimiter, requirePermission('procurement:create'), validateRequest(supplierPaymentSchema), procurementController.addPayment)

// Credit Notes
procurementRouter.get('/supplier-credit-notes', requirePermission('procurement:read'), procurementController.getAllCreditNotes)
procurementRouter.post('/supplier-credit-notes', mutationLimiter, requirePermission('procurement:return'), validateRequest(creditNoteSchema), procurementController.createCreditNote)
