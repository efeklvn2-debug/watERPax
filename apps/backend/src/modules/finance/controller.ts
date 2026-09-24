import { Request, Response } from 'express'
import { financeService } from './service'
import { logger } from '../../logger'
import { sendError } from '../../middleware/errorHandler'
import { auditService } from '../audit'

export const financeController = {
  async getAccounts(req: Request, res: Response) {
    try {
      const accounts = await financeService.getAccounts()
      res.json({ data: accounts })
    } catch (error: any) {
      sendError(res, error, 'finance.getAccounts')
    }
  },

  async getRootAccounts(req: Request, res: Response) {
    try {
      const accounts = await financeService.getRootAccounts()
      res.json({ data: accounts })
    } catch (error: any) {
      sendError(res, error, 'finance.getRootAccounts')
    }
  },

  async getAccountById(req: Request, res: Response) {
    try {
      const { id } = req.params
      const account = await financeService.getAccountById(id)
      res.json({ data: account })
    } catch (error: any) {
      sendError(res, error, 'finance.getAccountById')
    }
  },

  async createAccount(req: Request, res: Response) {
    try {
      const account = await financeService.createAccount(req.body)
      auditService.record({
        userId: (req as any).user?.id,
        action: 'finance.create_account',
        entityType: 'Account',
        entityId: account.id,
        description: `Created account ${account.code} ${account.name} (${account.type})`,
        ipAddress: req.ip
      })
      res.status(201).json({ data: account })
    } catch (error: any) {
      sendError(res, error, 'finance.createAccount')
    }
  },

  async postJournalEntry(req: Request, res: Response) {
    try {
      const entry = await financeService.postJournalEntry({
        ...req.body,
        postedById: (req as any).user?.id
      })
      auditService.record({
        userId: (req as any).user?.id,
        action: 'journal.post',
        entityType: 'JournalEntry',
        entityId: entry.id,
        description: `Posted ${entry.entryNumber}: ${entry.description || '(no description)'}`,
        metadata: { entryNumber: entry.entryNumber, sourceModule: entry.sourceModule },
        ipAddress: req.ip
      })
      res.status(201).json({ data: entry })
    } catch (error: any) {
      sendError(res, error, 'finance.postJournalEntry')
    }
  },

  async getJournalEntries(req: Request, res: Response) {
    try {
      const { dateFrom, dateTo, sourceModule, accountId, limit, offset } = req.query
      const entries = await financeService.getJournalEntries({
        dateFrom: dateFrom as string,
        dateTo: dateTo as string,
        sourceModule: sourceModule as string,
        accountId: accountId as string,
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined
      })
      res.json({ data: entries })
    } catch (error: any) {
      sendError(res, error, 'finance.getJournalEntries')
    }
  },

  async getJournalEntryById(req: Request, res: Response) {
    try {
      const { id } = req.params
      const entry = await financeService.getJournalEntryById(id)
      res.json({ data: entry })
    } catch (error: any) {
      sendError(res, error, 'finance.getJournalEntryById')
    }
  },

  async getAccountBalance(req: Request, res: Response) {
    try {
      const { id } = req.params
      const { asOfDate } = req.query
      const balance = await financeService.getAccountBalance(id, asOfDate as string)
      res.json({ data: balance })
    } catch (error: any) {
      sendError(res, error, 'finance.getAccountBalance')
    }
  },

  async getAllAccountBalances(req: Request, res: Response) {
    try {
      const { asOfDate } = req.query
      const balances = await financeService.getAllAccountBalances(asOfDate as string)
      res.json({ data: balances })
    } catch (error: any) {
      sendError(res, error, 'finance.getAllAccountBalances')
    }
  },

  async getTrialBalance(req: Request, res: Response) {
    try {
      const { asOfDate } = req.query
      const trialBalance = await financeService.getTrialBalance(asOfDate as string)
      res.json({ data: trialBalance })
    } catch (error: any) {
      sendError(res, error, 'finance.getTrialBalance')
    }
  },

  async getFinanceDashboard(req: Request, res: Response) {
    try {
      const { month } = req.query
      const dashboard = await financeService.getFinanceDashboard(month as string)
      res.json({ data: dashboard })
    } catch (error: any) {
      sendError(res, error, 'finance.getFinanceDashboard')
    }
  },

  async getVatSummary(req: Request, res: Response) {
    try {
      const { dateFrom, dateTo } = req.query
      const summary = await financeService.getVatSummary(dateFrom as string, dateTo as string)
      res.json({ data: summary })
    } catch (error: any) {
      sendError(res, error, 'finance.getVatSummary')
    }
  },

  async getProfitSummary(req: Request, res: Response) {
    try {
      const { month } = req.query
      const summary = await financeService.getProfitSummary(month as string)
      res.json({ data: summary })
    } catch (error: any) {
      sendError(res, error, 'finance.getProfitSummary')
    }
  },

  async getGeneralLedger(req: Request, res: Response) {
    try {
      const { id } = req.params
      const { dateFrom, dateTo } = req.query
      const ledger = await financeService.getGeneralLedger(id, dateFrom as string, dateTo as string)
      res.json({ data: ledger })
    } catch (error: any) {
      sendError(res, error, 'finance.getGeneralLedger')
    }
  },

  async seedAccounts(req: Request, res: Response) {
    try {
      const result = await financeService.seedDefaultAccounts()
      res.json({ data: result })
    } catch (error: any) {
      sendError(res, error, 'finance.seedAccounts')
    }
  },

  async getDeferredCogsSummary(req: Request, res: Response) {
    try {
      const summary = await financeService.getDeferredCogsSummary()
      res.json({ data: summary })
    } catch (error: any) {
      sendError(res, error, 'finance.getDeferredCogsSummary')
    }
  },

  async recognizeDeferredCogs(req: Request, res: Response) {
    try {
      const { id } = req.params
      const userId = (req as any).user?.id
      const result = await financeService.recognizeDeferredCogs(id, userId)
      res.json({ data: result })
    } catch (error: any) {
      sendError(res, error, 'finance.recognizeDeferredCogs')
    }
  },

  async reverseJournalEntry(req: Request, res: Response) {
    try {
      const { id } = req.params
      const userId = (req as any).user?.id
      const entry = await financeService.reverseJournalEntry(id, userId)
      auditService.record({
        userId,
        action: 'journal.reverse',
        entityType: 'JournalEntry',
        entityId: id,
        description: `Reversed journal entry ${id}`,
        ipAddress: req.ip
      })
      res.status(201).json({ data: entry })
    } catch (error: any) {
      sendError(res, error, 'finance.reverseJournalEntry')
    }
  }
}
