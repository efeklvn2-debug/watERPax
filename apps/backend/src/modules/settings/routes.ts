import { Router } from 'express'
import { settingsController } from './controller'
import { validateRequest } from '../../middleware/validation'
import { overheadRateSchema, vatSettingsSchema, invoiceSettingsSchema, booksLockedSchema, taxSettingsSchema, jarMaterialCodeSchema } from './validation'
import { authenticate, loadUser, requirePermission } from '../../middleware/auth'
import { tenantMiddleware, requireTenantUser } from '../../middleware/tenant'

export const settingsRouter = Router()

settingsRouter.use(authenticate, loadUser, requireTenantUser, tenantMiddleware)

settingsRouter.get('/', requirePermission('settings:read'), settingsController.getSettings)
settingsRouter.get('/overhead-rate', requirePermission('settings:read'), settingsController.getOverheadRate)
settingsRouter.patch('/overhead-rate', requirePermission('settings:write'), validateRequest(overheadRateSchema), settingsController.updateOverheadRate)
settingsRouter.get('/overhead-rate-history', requirePermission('settings:read'), settingsController.getOverheadRateHistory)
settingsRouter.patch('/vat', requirePermission('settings:write'), validateRequest(vatSettingsSchema), settingsController.updateVatSettings)
settingsRouter.get('/invoice', requirePermission('settings:read'), settingsController.getInvoiceSettings)
settingsRouter.patch('/invoice', requirePermission('settings:write'), validateRequest(invoiceSettingsSchema), settingsController.updateInvoiceSettings)
settingsRouter.patch('/books-locked', requirePermission('finance:manage_accounts'), validateRequest(booksLockedSchema), settingsController.updateBooksLocked)
settingsRouter.patch('/tax', requirePermission('settings:write'), validateRequest(taxSettingsSchema), settingsController.updateTaxSettings)
settingsRouter.patch('/jar-material-code', requirePermission('settings:write'), validateRequest(jarMaterialCodeSchema), settingsController.updateJarMaterialCode)
