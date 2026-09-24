import { prisma } from '../../database'
import { AppError } from '../../middleware/errorHandler'
import { createChildLogger } from '../../logger'
import { getCurrentTenantId } from '../../context'
import { financeService } from '../finance/service'
import { financeRepository } from '../finance/repository'
import { dateStartOfDay, dateEndOfDay } from '../../utils/dates'
import type {
  TaxSummary, CitProvisionResult, CitMonthlyBreakdown,
  FilingPack, PayeSummaryEntry, PayeEntryInput, TaxSettings
} from './types'

const logger = createChildLogger('tax:service')

async function getSettings(): Promise<TaxSettings> {
  const s = await prisma.settings.findFirst()
  if (!s) {
    return { citRate: 0.30, vatFilingFrequency: 'monthly' }
  }
  return {
    citRate: Number(s.citRate) || 0.30,
    vatFilingFrequency: (s as any).vatFilingFrequency || 'monthly',
  }
}

function getYearRange(year: number) {
  const start = new Date(year, 0, 1, 0, 0, 0)
  const end = new Date(year, 11, 31, 23, 59, 59)
  return { start, end }
}

async function getMonthlyBreakdown(year: number): Promise<CitMonthlyBreakdown[]> {
  const breakdown: CitMonthlyBreakdown[] = []

  for (let m = 0; m < 12; m++) {
    const start = new Date(year, m, 1, 0, 0, 0)
    const end = new Date(year, m + 1, 0, 23, 59, 59)

    const revenue = await financeRepository.getRevenueByPeriod(start, end)
    const cogs = await financeRepository.getCogsByPeriod(start, end)
    const expenses = await financeRepository.getExpensesByPeriod(start, end)

    const totalRevenue = revenue.sales + revenue.packing + revenue.otherIncome
    const totalExpenses = Object.values(expenses).reduce((a: number, b: number) => a + b, 0)
    const netProfit = totalRevenue - cogs - totalExpenses

    breakdown.push({
      month: `${year}-${String(m + 1).padStart(2, '0')}`,
      revenue: totalRevenue,
      cogs,
      expenses: totalExpenses,
      netProfit,
      expenseBreakdown: expenses,
    })
  }

  return breakdown
}

export const taxService = {
  async getSettings(): Promise<TaxSettings> {
    return getSettings()
  },

  async updateSettings(input: Partial<TaxSettings>): Promise<TaxSettings> {
    const tenantId = getCurrentTenantId()!
    await prisma.settings.upsert({
      where: { tenantId },
      update: {
        citRate: input.citRate !== undefined ? (input.citRate as any) : undefined,
        vatFilingFrequency: input.vatFilingFrequency,
      },
      create: {
        citRate: (input.citRate ?? 0.30) as any,
        vatFilingFrequency: input.vatFilingFrequency ?? 'monthly',
      } as any,
    })
    return getSettings()
  },

  async getTaxSummary(year: number): Promise<TaxSummary> {
    const settings = await getSettings()
    const { start, end } = getYearRange(year)

    const revenue = await financeRepository.getRevenueByPeriod(start, end)
    const cogs = await financeRepository.getCogsByPeriod(start, end)
    const expenses = await financeRepository.getExpensesByPeriod(start, end)

    const totalRevenue = revenue.sales + revenue.packing + revenue.otherIncome
    const totalExpenses = Object.values(expenses).reduce((a: number, b: number) => a + b, 0)
    const netProfit = totalRevenue - cogs - totalExpenses
    const citAmount = netProfit * settings.citRate

    const existingProvision = await prisma.taxProvision.findFirst({
      where: { year, tenantId: getCurrentTenantId()! },
    })

    const outputVat = await financeRepository.getOutputVat(start, end)
    const inputVat = await financeRepository.getInputVat(start, end)

    const payeEntries = await prisma.payeEntry.findMany({
      where: { tenantId: getCurrentTenantId()!, year },
      orderBy: { createdAt: 'desc' },
    })
    const totalPaye = payeEntries.reduce((s, e) => s + Number(e.amount), 0)

    return {
      year,
      cit: {
        netProfit,
        citRate: settings.citRate,
        citAmount,
        posted: !!existingProvision?.posted,
      },
      vat: {
        outputVat,
        inputVat,
        vatPayable: outputVat - inputVat,
      },
      paye: {
        total: totalPaye,
        entries: payeEntries.map(e => ({
          id: e.id,
          period: e.period,
          year: e.year,
          month: e.month,
          amount: Number(e.amount),
          pension: Number(e.pension),
          description: e.description || undefined,
          createdAt: e.createdAt,
        })),
      },
    }
  },

  async getCitProvision(year: number): Promise<CitProvisionResult> {
    const settings = await getSettings()
    const { start, end } = getYearRange(year)

    const revenue = await financeRepository.getRevenueByPeriod(start, end)
    const cogs = await financeRepository.getCogsByPeriod(start, end)
    const expenses = await financeRepository.getExpensesByPeriod(start, end)

    const totalRevenue = revenue.sales + revenue.packing + revenue.otherIncome
    const totalExpenses = Object.values(expenses).reduce((a: number, b: number) => a + b, 0)
    const netProfit = totalRevenue - cogs - totalExpenses
    const citAmount = netProfit * settings.citRate

    const monthlyBreakdown = await getMonthlyBreakdown(year)

    const existingProvision = await prisma.taxProvision.findFirst({
      where: { year, tenantId: getCurrentTenantId()! },
    })

    return {
      year,
      netProfit,
      citRate: settings.citRate,
      citAmount,
      posted: !!existingProvision?.posted,
      monthlyBreakdown,
    }
  },

  async postCitProvision(year: number, userId: string): Promise<{ provision: any; journalEntry: any }> {
    const settings = await getSettings()
    const { start, end } = getYearRange(year)

    const revenue = await financeRepository.getRevenueByPeriod(start, end)
    const cogs = await financeRepository.getCogsByPeriod(start, end)
    const expenses = await financeRepository.getExpensesByPeriod(start, end)

    const totalRevenue = revenue.sales + revenue.packing + revenue.otherIncome
    const totalExpenses = Object.values(expenses).reduce((a: number, b: number) => a + b, 0)
    const netProfit = totalRevenue - cogs - totalExpenses
    const citAmount = netProfit * settings.citRate

    const existing = await prisma.taxProvision.findFirst({
      where: { year, tenantId: getCurrentTenantId()! },
    })

    if (existing && existing.posted) {
      throw new AppError(400, 'CONFLICT', `CIT provision for ${year} has already been posted`)
    }

    if (netProfit <= 0) {
      throw new AppError(400, 'NO_PROFIT', `No taxable profit for ${year} (net ${netProfit.toFixed(2)}). Nothing to provide.`)
    }

    const citExpenseAccountId = await financeService.getAccountIdByCode('2510')
    const citPayableAccountId = await financeService.getAccountIdByCode('2330')

    if (!citExpenseAccountId || !citPayableAccountId) {
      throw new AppError(400, 'NOT_FOUND', 'CIT accounts (2510/2330) not found. Ensure chart of accounts is seeded.')
    }

    const result = await prisma.$transaction(async (tx) => {
      const je = await financeService.postJournalEntry({
        description: `CIT provision for FY ${year} (net profit: ${netProfit.toFixed(2)} × ${settings.citRate * 100}% = ${citAmount.toFixed(2)})`,
        sourceModule: 'TAX',
        sourceId: `cit-${year}-${getCurrentTenantId()!}`,
        lines: [
          { accountId: citExpenseAccountId, debit: citAmount, credit: 0, memo: `CIT provision ${year}` },
          { accountId: citPayableAccountId, debit: 0, credit: citAmount, memo: `CIT payable ${year}` },
        ],
        postedById: userId,
      }, tx)

      const provision = await tx.taxProvision.upsert({
        where: {
          tenantId_year_period: {
            tenantId: getCurrentTenantId()!,
            year,
            period: String(year),
          },
        },
        update: {
          netProfit: netProfit as any,
          citRate: settings.citRate as any,
          citAmount: citAmount as any,
          posted: true,
          postedById: userId,
          postedAt: new Date(),
        },
        create: {
          year,
          period: String(year),
          netProfit: netProfit as any,
          citRate: settings.citRate as any,
          citAmount: citAmount as any,
          posted: true,
          postedById: userId,
          postedAt: new Date(),
        } as any,
      })

      return { provision, journalEntry: je }
    })

    logger.info({ year, citAmount }, 'CIT provision posted')
    return result
  },

  async getPayeEntries(year: number): Promise<PayeSummaryEntry[]> {
    const entries = await prisma.payeEntry.findMany({
      where: { tenantId: getCurrentTenantId()!, year },
      orderBy: { createdAt: 'desc' },
    })
    return entries.map(e => ({
      id: e.id,
      period: e.period,
      year: e.year,
      month: e.month,
      amount: Number(e.amount),
      pension: Number(e.pension),
      description: e.description || undefined,
      createdAt: e.createdAt,
    }))
  },

  async addPayeEntry(input: PayeEntryInput, userId: string): Promise<PayeSummaryEntry> {
    const existing = await prisma.payeEntry.findFirst({
      where: { year: input.year, month: input.month, tenantId: getCurrentTenantId()! },
    })
    if (existing) {
      throw new AppError(409, 'CONFLICT', `PAYE entry already exists for ${input.year}-${String(input.month).padStart(2, '0')}`)
    }

    const entry = await prisma.payeEntry.create({
      data: {
        period: input.period,
        year: input.year,
        month: input.month,
        amount: input.amount as any,
        pension: (input.pension || 0) as any,
        description: input.description,
        recordedById: userId,
      } as any,
    })

    logger.info({ year: input.year, month: input.month, amount: input.amount }, 'PAYE entry recorded')

    return {
      id: entry.id,
      period: entry.period,
      year: entry.year,
      month: entry.month,
      amount: Number(entry.amount),
      pension: Number(entry.pension),
      description: entry.description || undefined,
      createdAt: entry.createdAt,
    }
  },

  async deletePayeEntry(id: string): Promise<void> {
    const deleted = await prisma.payeEntry.deleteMany({
      where: { id, tenantId: getCurrentTenantId()! },
    })
    if (deleted.count === 0) {
      throw new AppError(404, 'NOT_FOUND', 'PAYE entry not found')
    }
  },

  async getFilingPack(year: number): Promise<FilingPack> {
    const taxSettings = await getSettings()
    const { start, end } = getYearRange(year)

    const revenue = await financeRepository.getRevenueByPeriod(start, end)
    const cogs = await financeRepository.getCogsByPeriod(start, end)
    const expenses = await financeRepository.getExpensesByPeriod(start, end)

    const totalRevenue = revenue.sales + revenue.packing + revenue.otherIncome
    const totalExpenses = Object.values(expenses).reduce((a: number, b: number) => a + b, 0)
    const netProfit = totalRevenue - cogs - totalExpenses
    const citAmount = netProfit * taxSettings.citRate

    const existingProvision = await prisma.taxProvision.findFirst({
      where: { year, tenantId: getCurrentTenantId()! },
    })

    const settings = await prisma.settings.findFirst()
    const company = {
      tin: settings?.businessTin || undefined,
      name: (settings as any)?.invoiceCompanyName || undefined,
      address: settings?.businessAddress || undefined,
    }

    const vatSummary = await financeService.getVatSummary(`${year}-01-01`, `${year}-12-31`)

    const payeEntries = await this.getPayeEntries(year)
    const totalPaye = payeEntries.reduce((s, e) => s + e.amount, 0)

    return {
      company,
      period: String(year),
      cit: {
        netProfit,
        rate: taxSettings.citRate,
        provision: citAmount,
        posted: !!existingProvision?.posted,
      },
      vat: {
        output: vatSummary.outputVat,
        input: vatSummary.inputVat,
        payable: vatSummary.vatPayable,
        periods: vatSummary.periods.map(p => ({
          month: p.month,
          outputVat: p.outputVat,
          inputVat: p.inputVat,
          vatPayable: p.vatPayable,
        })),
      },
      paye: {
        total: totalPaye,
        entries: payeEntries,
      },
    }
  },
}
