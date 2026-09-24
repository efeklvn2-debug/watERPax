import { z } from 'zod'

export const createRunSchema = z.object({
  variantId: z.string().trim().min(1, 'Variant is required'),
  plannedPacks: z.number().int().positive('Planned packs must be a positive whole number'),
  batchNumber: z.string().trim().min(1).max(64).optional(),
  notes: z.string().trim().max(1000).optional()
})

export const startRunSchema = z.object({})

export const usageOverrideSchema = z.object({
  materialId: z.string().trim().min(1, 'Material is required'),
  actualQty: z.number().finite().min(0, 'Actual quantity cannot be negative'),
  wasteQty: z.number().finite().min(0, 'Waste cannot be negative').default(0)
})

export const completeRunSchema = z.object({
  actualPacks: z.number().int().positive('Actual packs must be a positive whole number'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  notes: z.string().trim().max(1000).optional(),
  usages: z.array(usageOverrideSchema).max(500).optional()
})

export const cancelRunSchema = z.object({
  reason: z.string().trim().max(500).optional()
})

export type CreateRunInput = z.infer<typeof createRunSchema>
export type CompleteRunInput = z.infer<typeof completeRunSchema>
export type CancelRunInput = z.infer<typeof cancelRunSchema>
