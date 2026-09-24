import { z } from 'zod'

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  code: z.string().trim().min(1).max(32).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().trim().max(32).optional(),
  address: z.string().trim().max(500).optional(),
  paymentType: z.enum(['CASH', 'CREDIT']).optional(),
  creditLimit: z.number().finite().min(0).optional(),
  depositPercentDefault: z.number().min(0).max(100).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  notifyEmail: z.boolean().optional(),
  notifyWhatsApp: z.boolean().optional()
})

export const updateCustomerSchema = createCustomerSchema.partial()

export const recordJarReturnSchema = z.object({
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  notes: z.string().max(200).optional()
})

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>
export type RecordJarReturnInput = z.infer<typeof recordJarReturnSchema>
