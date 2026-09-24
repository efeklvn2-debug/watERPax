import { Router } from 'express'
import { authenticate, loadUser, requirePermission } from '../../middleware/auth'
import { tenantMiddleware, requireTenantUser } from '../../middleware/tenant'
import { reportLimiter } from '../../middleware/rateLimiters'
import { reportsController } from './controller'

export const reportsRouter = Router()

reportsRouter.use(reportLimiter)
reportsRouter.use(authenticate)
reportsRouter.use(loadUser)
reportsRouter.use(requireTenantUser)
reportsRouter.use(tenantMiddleware)
reportsRouter.use(requirePermission('report:read'))

reportsRouter.get('/aging/receivables', reportsController.getAgingReceivables)
reportsRouter.get('/aging/payables', reportsController.getAgingPayables)
reportsRouter.get('/sales/by-customer', reportsController.getSalesByCustomer)
reportsRouter.get('/sales/by-product', reportsController.getSalesByProduct)
reportsRouter.get('/inventory/movements', reportsController.getInventoryMovements)
reportsRouter.get('/profit', reportsController.getProfitRange)
reportsRouter.get('/balance-sheet', reportsController.getBalanceSheet)
reportsRouter.get('/inventory/gl-reconciliation', reportsController.getInventoryGLReconciliation)
reportsRouter.get('/bank-movements', reportsController.getBankMovements)

// Water (MTS) reports: fg-valuation | production-output | waste | variance | sales-by-sku | low-raw
reportsRouter.get('/water/:name', reportsController.waterReport)
reportsRouter.get('/dashboard', reportsController.dashboard)
