import { z } from 'zod'

export const overheadRateSchema = z.object({
  rate: z.number().min(0, 'Rate must be non-negative')
})

export const vatSettingsSchema = z.object({
  vatRate: z.number().min(0).max(100).optional(),
  businessTin: z.string().max(50).optional(),
  businessAddress: z.string().max(500).optional()
})

export const invoiceSettingsSchema = z.object({
  invoiceCompanyName: z.string().max(200).optional(),
  invoiceLogoUrl: z.string().max(500).optional(),
  invoicePrimaryColor: z.string().max(20).optional(),
  invoiceAccentColor: z.string().max(20).optional(),
  invoiceFooter: z.string().max(1000).optional(),
  receiptCompanyName: z.string().max(200).optional(),
  receiptLogoUrl: z.string().max(500).optional(),
  receiptFooter: z.string().max(1000).optional()
})

export const booksLockedSchema = z.object({
  booksLockedUntil: z.string().nullable()
})

export const taxSettingsSchema = z.object({
  citRate: z.number().min(0).max(1),
  vatFilingFrequency: z.enum(['monthly', 'quarterly']),
}).partial()

export const jarMaterialCodeSchema = z.object({
  jarMaterialCode: z.string().max(32).nullable()
})
