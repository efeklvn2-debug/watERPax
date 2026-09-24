import { Router } from 'express'
import { financeController } from './controller'
import { authenticate, loadUser, requirePermission } from '../../middleware/auth'
import { tenantMiddleware, requireTenantUser } from '../../middleware/tenant'
import { validateRequest } from '../../middleware/validation'
import { sensitiveLimiter, heavyLimiter, reportLimiter, mutationLimiter } from '../../middleware/rateLimiters'
import { createAccountSchema, postJournalEntrySchema } from './validation'

export const financeRouter = Router()

financeRouter.use(authenticate, loadUser, requireTenantUser, tenantMiddleware)

financeRouter.get('/accounts', requirePermission('finance:read'), financeController.getAccounts)
financeRouter.get('/accounts/tree', requirePermission('finance:read'), financeController.getRootAccounts)
financeRouter.get('/accounts/:id', requirePermission('finance:read'), financeController.getAccountById)
financeRouter.post('/accounts', requirePermission('finance:manage_accounts'), validateRequest(createAccountSchema), financeController.createAccount)

financeRouter.get('/journal', reportLimiter, requirePermission('finance:read'), financeController.getJournalEntries)
financeRouter.get('/journal/:id', requirePermission('finance:read'), financeController.getJournalEntryById)
financeRouter.post('/journal', mutationLimiter, requirePermission('finance:write'), validateRequest(postJournalEntrySchema), financeController.postJournalEntry)
financeRouter.post('/journal/:id/reverse', sensitiveLimiter, requirePermission('finance:write'), financeController.reverseJournalEntry)

financeRouter.get('/balances', requirePermission('finance:read'), financeController.getAllAccountBalances)
financeRouter.get('/balances/:id', requirePermission('finance:read'), financeController.getAccountBalance)
financeRouter.get('/trial-balance', heavyLimiter, requirePermission('finance:read'), financeController.getTrialBalance)
financeRouter.get('/ledger/:id', requirePermission('finance:read'), financeController.getGeneralLedger)

financeRouter.get('/dashboard', requirePermission('finance:read'), financeController.getFinanceDashboard)
financeRouter.get('/vat', requirePermission('finance:read'), financeController.getVatSummary)
financeRouter.get('/profit', requirePermission('finance:read'), financeController.getProfitSummary)

financeRouter.get('/deferred-cogs', requirePermission('finance:read'), financeController.getDeferredCogsSummary)
financeRouter.post('/deferred-cogs/:id/recognize', mutationLimiter, requirePermission('finance:write'), financeController.recognizeDeferredCogs)

financeRouter.post('/seed', heavyLimiter, requirePermission('finance:manage_accounts'), financeController.seedAccounts)
