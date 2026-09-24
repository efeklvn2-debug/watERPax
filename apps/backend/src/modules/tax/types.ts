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
    entries: PayeSummaryEntry[]
  }
}

export interface PayeSummaryEntry {
  id: string
  period: string
  year: number
  month: number
  amount: number
  pension: number
  description?: string
  createdAt: Date
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
    entries: PayeSummaryEntry[]
  }
}

export interface VatMonthly {
  month: string
  outputVat: number
  inputVat: number
  vatPayable: number
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
