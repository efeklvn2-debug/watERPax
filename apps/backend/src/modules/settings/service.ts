import { prisma } from '../../database'
import { AppError } from '../../middleware/errorHandler'
import { createChildLogger } from '../../logger'
import { getCurrentTenantId } from '../../context'

const logger = createChildLogger('settings:service')

export interface Settings {
  id: string
  overheadRatePerKg: number
  vatRate: number
  citRate: number
  vatFilingFrequency: string
  businessTin?: string
  businessAddress?: string
  invoiceCompanyName?: string
  invoiceLogoUrl?: string
  invoicePrimaryColor?: string
  invoiceAccentColor?: string
  invoiceFooter?: string
  receiptCompanyName?: string
  receiptLogoUrl?: string
  receiptFooter?: string
  booksLockedUntil?: string
  jarMaterialCode?: string
}

export interface VatSettings {
  vatRate: number
  businessTin?: string
  businessAddress?: string
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

export const settingsService = {
  async getSettings(): Promise<Settings> {
    let settings = await prisma.settings.findFirst()

    if (!settings) {
      settings = await prisma.settings.create({
        data: {} as any
      })
    }

    return {
      id: settings.id,
      overheadRatePerKg: Number((settings as any).overheadRatePerKg || 0),
      vatRate: Number((settings as any).vatRate || 7.5),
      citRate: Number((settings as any).citRate || 0.30),
      vatFilingFrequency: (settings as any).vatFilingFrequency || 'monthly',
      businessTin: (settings as any).businessTin || undefined,
      businessAddress: (settings as any).businessAddress || undefined,
      invoiceCompanyName: (settings as any).invoiceCompanyName || undefined,
      invoiceLogoUrl: (settings as any).invoiceLogoUrl || undefined,
      invoicePrimaryColor: (settings as any).invoicePrimaryColor || undefined,
      invoiceAccentColor: (settings as any).invoiceAccentColor || undefined,
      invoiceFooter: (settings as any).invoiceFooter || undefined,
      receiptCompanyName: (settings as any).receiptCompanyName || undefined,
      receiptLogoUrl: (settings as any).receiptLogoUrl || undefined,
      receiptFooter: (settings as any).receiptFooter || undefined,
      booksLockedUntil: (settings as any).booksLockedUntil?.toISOString().split('T')[0] || undefined,
      jarMaterialCode: (settings as any).jarMaterialCode || undefined
    }
  },

  async getOverheadRate(): Promise<number> {
    const settings = await this.getSettings()
    return settings.overheadRatePerKg
  },

  async updateOverheadRate(rate: number, userId?: string): Promise<number> {
    logger.info({ rate }, 'Updating overhead rate')

    await prisma.settings.upsert({
      where: { tenantId: getCurrentTenantId()! },
      update: { overheadRatePerKg: rate } as any,
      create: { overheadRatePerKg: rate } as any
    })

    return rate
  },

  // OverheadRateHistory was a flexo concept (per-month ink-roll costing).
  // Kept as a stub for backward compat — frontend still calls it on load.
  // Returns empty; no DB table exists anymore (dropped in Phase 3).
  async getOverheadRateHistory(): Promise<never[]> {
    return []
  },

  async updateVatSettings(input: Partial<VatSettings>): Promise<Settings> {
    await prisma.settings.upsert({
      where: { tenantId: getCurrentTenantId()! },
      update: {
        vatRate: input.vatRate,
        businessTin: input.businessTin,
        businessAddress: input.businessAddress
      },
      create: {
        vatRate: input.vatRate || 7.5,
        businessTin: input.businessTin,
        businessAddress: input.businessAddress
      } as any
    })
    return this.getSettings()
  },

  async getInvoiceSettings(): Promise<InvoiceSettings> {
    const settings = await this.getSettings()
    return {
      invoiceCompanyName: settings.invoiceCompanyName || undefined,
      invoiceLogoUrl: settings.invoiceLogoUrl || undefined,
      invoicePrimaryColor: settings.invoicePrimaryColor || undefined,
      invoiceAccentColor: settings.invoiceAccentColor || undefined,
      invoiceFooter: settings.invoiceFooter || undefined,
      receiptCompanyName: settings.receiptCompanyName || undefined,
      receiptLogoUrl: settings.receiptLogoUrl || undefined,
      receiptFooter: settings.receiptFooter || undefined
    }
  },

  async updateInvoiceSettings(input: InvoiceSettings): Promise<InvoiceSettings> {
    await prisma.settings.upsert({
      where: { tenantId: getCurrentTenantId()! },
      update: {
        invoiceCompanyName: input.invoiceCompanyName,
        invoiceLogoUrl: input.invoiceLogoUrl,
        invoicePrimaryColor: input.invoicePrimaryColor,
        invoiceAccentColor: input.invoiceAccentColor,
        invoiceFooter: input.invoiceFooter,
        receiptCompanyName: input.receiptCompanyName,
        receiptLogoUrl: input.receiptLogoUrl,
        receiptFooter: input.receiptFooter
      },
      create: {
        invoiceCompanyName: input.invoiceCompanyName,
        invoiceLogoUrl: input.invoiceLogoUrl,
        invoicePrimaryColor: input.invoicePrimaryColor,
        invoiceAccentColor: input.invoiceAccentColor,
        invoiceFooter: input.invoiceFooter,
        receiptCompanyName: input.receiptCompanyName,
        receiptLogoUrl: input.receiptLogoUrl,
        receiptFooter: input.receiptFooter
      } as any
    })
    return this.getInvoiceSettings()
  },

  async updateBooksLockedUntil(date: string | null): Promise<{ booksLockedUntil: string | null }> {
    await prisma.settings.upsert({
      where: { tenantId: getCurrentTenantId()! },
      update: { booksLockedUntil: date ? new Date(date) : null } as any,
      create: { booksLockedUntil: date ? new Date(date) : null } as any
    })
    return { booksLockedUntil: date }
  },

  async updateTaxSettings(input: { citRate?: number; vatFilingFrequency?: string }): Promise<Settings> {
    await prisma.settings.upsert({
      where: { tenantId: getCurrentTenantId()! },
      update: {
        citRate: input.citRate !== undefined ? (input.citRate as any) : undefined,
        vatFilingFrequency: input.vatFilingFrequency,
      },
      create: {
        citRate: (input.citRate ?? 0.30) as any,
        vatFilingFrequency: input.vatFilingFrequency ?? 'monthly',
      } as any,
    })
    return this.getSettings()
  },

  async updateJarMaterialCode(code: string | null): Promise<{ jarMaterialCode: string | null }> {
    await prisma.settings.upsert({
      where: { tenantId: getCurrentTenantId()! },
      update: { jarMaterialCode: code || null } as any,
      create: { jarMaterialCode: code || null } as any
    })
    return { jarMaterialCode: code || null }
  },
}
