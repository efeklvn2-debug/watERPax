import { z } from 'zod'

export const postProvisionSchema = z.object({
  year: z.number().int().min(2000).max(2100),
})

export const postPayeSchema = z.object({
  period: z.string().min(1, 'Period is required'),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  amount: z.number().min(0, 'Amount must be non-negative'),
  pension: z.number().min(0, 'Pension must be non-negative').default(0),
  description: z.string().max(500).optional(),
})

export const taxSettingsSchema = z.object({
  citRate: z.number().min(0).max(1),
  vatFilingFrequency: z.enum(['monthly', 'quarterly']),
}).partial()

export type PostProvisionInput = z.infer<typeof postProvisionSchema>
export type PostPayeInput = z.infer<typeof postPayeSchema>
export type TaxSettingsInput = z.infer<typeof taxSettingsSchema>
