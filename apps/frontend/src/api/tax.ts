import { api } from './client'

export interface TaxSummary {
  year: number
  cit: {
    netProfit: number
    citRate: number
    citAmount: number
    posted: boolean
  }
  vat: {
    outputVat: number
    inputVat: number
    vatPayable: number
  }
  paye: {
    total: number
    entries: PayeEntry[]
  }
}

export interface CitProvisionResult {
  year: number
  netProfit: number
  citRate: number
  citAmount: number
  posted: boolean
  monthlyBreakdown: CitMonthlyBreakdown[]
}

export interface CitMonthlyBreakdown {
  month: string
  revenue: number
  cogs: number
  expenses: number
  netProfit: number
  expenseBreakdown: Record<string, number>
}

export interface FilingPack {
  company: {
    tin?: string
    name?: string
    address?: string
  }
  period: string
  cit: {
    netProfit: number
    rate: number
    provision: number
    posted: boolean
  }
  vat: {
    output: number
    input: number
    payable: number
    periods: VatMonthly[]
  }
  paye: {
    total: number
    entries: PayeEntry[]
  }
}

export interface VatMonthly {
  month: string
  outputVat: number
  inputVat: number
  vatPayable: number
}

export interface PayeEntry {
  id: string
  period: string
  year: number
  month: number
  amount: number
  pension: number
  description?: string
  createdAt: Date
}

export interface PayeEntryInput {
  period: string
  year: number
  month: number
  amount: number
  pension?: number
  description?: string
}

export interface TaxSettings {
  citRate: number
  vatFilingFrequency: string
}

export const taxApi = {
  getTaxSummary: (year: number) =>
    api.get<TaxSummary>(`/tax/summary?year=${year}`),

  getCitProvision: (year: number) =>
    api.get<CitProvisionResult>(`/tax/cit?year=${year}`),

  postCitProvision: (year: number) =>
    api.post<{ provision: any; journalEntry: any }>(`/tax/provision`, { year }),

  getPayeEntries: (year: number) =>
    api.get<PayeEntry[]>(`/tax/paye?year=${year}`),

  addPayeEntry: (data: PayeEntryInput) =>
    api.post<PayeEntry>(`/tax/paye`, data),

  deletePayeEntry: (id: string) =>
    api.delete(`/tax/paye/${id}`),

  getFilingPack: (year: number) =>
    api.get<FilingPack>(`/tax/filing-pack?year=${year}`),

  getSettings: () =>
    api.get<TaxSettings>(`/tax/settings`),

  updateSettings: (data: Partial<TaxSettings>) =>
    api.patch<TaxSettings>(`/settings/tax`, data),
}
