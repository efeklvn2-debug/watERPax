import { api } from './client'

export interface ConsumptionRates {
  coreWeight: number
  inkConsumptionRate: number
  ipaConsumptionRate: number
  butanolConsumptionRate: number
  tolueneConsumptionRate: number
  coreDepositValue: number
}

export interface Settings {
  id: string
  coreWeight: number
  rollWeight: number
  inkConsumptionRate: number
  ipaConsumptionRate: number
  butanolConsumptionRate: number
  tolueneConsumptionRate: number
  coreDepositValue: number
  vatRate: number
  citRate: number
  vatFilingFrequency: string
  overheadRatePerKg: number
  businessTin?: string
  businessAddress?: string
  booksLockedUntil?: string
  jarMaterialCode?: string
}

export interface VatSettings {
  vatRate: number
  businessTin?: string
  businessAddress?: string
}

export interface OverheadRateHistoryEntry {
  id: string
  month: Date
  ratePerKg: number
  createdAt: Date
  createdBy?: string
}

export interface InvoiceSettings {
  invoiceCompanyName?: string
  invoiceLogoUrl?: string
  invoicePrimaryColor?: string
  invoiceAccentColor?: string
  invoiceFooter?: string
  receiptCompanyName?: string
  receiptLogoUrl?: string
  receiptFooter?: string
}

export const settingsApi = {
  getSettings: async () => {
    return api.get<Settings>('/settings')
  },

  updateSettings: async (data: Partial<Settings>) => {
    return api.patch<Settings>('/settings', data)
  },

  getConsumptionRates: async () => {
    return api.get<ConsumptionRates>('/settings/consumption-rates')
  },

  updateConsumptionRates: async (data: Partial<ConsumptionRates>) => {
    return api.patch<ConsumptionRates>('/settings/consumption-rates', data)
  },

  getOverheadRate: async () => {
    return api.get<number>('/settings/overhead-rate')
  },

  updateOverheadRate: async (rate: number) => {
    return api.patch<number>('/settings/overhead-rate', { rate })
  },

  getOverheadRateHistory: async () => {
    return api.get<OverheadRateHistoryEntry[]>('/settings/overhead-rate-history')
  },

  updateVatSettings: async (data: Partial<VatSettings>) => {
    return api.patch<Settings>('/settings/vat', data)
  },

  getInvoiceSettings: async () => {
    return api.get<InvoiceSettings>('/settings/invoice')
  },

  updateInvoiceSettings: async (data: InvoiceSettings) => {
    return api.patch<InvoiceSettings>('/settings/invoice', data)
  },

  // Ink Colors
  getInkColors: async (includeInactive = false) => {
    return api.get<any[]>(`/settings/ink-colors?includeInactive=${includeInactive}`)
  },

  createInkColor: async (data: { name: string; mapping: string }) => {
    return api.post<any>('/settings/ink-colors', data)
  },

  updateInkColor: async (id: string, data: { name?: string; mapping?: string }) => {
    return api.patch<any>(`/settings/ink-colors/${id}`, data)
  },

  archiveInkColor: async (id: string) => {
    return api.patch<any>(`/settings/ink-colors/${id}/archive`, {})
  },

  restoreInkColor: async (id: string) => {
    return api.patch<any>(`/settings/ink-colors/${id}/restore`, {})
  },

  updateBooksLocked: async (booksLockedUntil: string | null) => {
    return api.patch<{ booksLockedUntil: string | null }>('/settings/books-locked', { booksLockedUntil })
  },

  updateJarMaterialCode: async (jarMaterialCode: string | null) => {
    return api.patch<{ jarMaterialCode: string | null }>('/settings/jar-material-code', { jarMaterialCode })
  }
}
