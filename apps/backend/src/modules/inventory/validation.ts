import { z } from 'zod'

export const materialSchema = z.object({
  code: z.string().min(1, 'Code is required'),
  name: z.string().min(1, 'Name is required'),
  category: z.enum(['RAW_MATERIAL', 'PACKAGING', 'FINISHED_GOOD', 'CONSUMABLE']),
  unitOfMeasure: z.string().optional(),
  minStock: z.number().int().min(0).optional(),
  costPrice: z.number().positive().optional(),
  subCategory: z.string().optional(),
  totalStock: z.number().optional()
})

export const materialUpdateSchema = materialSchema.partial()

export const stockMovementSchema = z.object({
  materialId: z.string().min(1, 'Material ID is required'),
  stockId: z.string().optional(),
  type: z.enum(['IN', 'OUT', 'ADJUSTMENT', 'TRANSFER']),
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  reference: z.string().optional(),
  notes: z.string().optional()
})

export type MaterialInput = z.infer<typeof materialSchema>
export type MaterialUpdateInput = z.infer<typeof materialUpdateSchema>
export type StockMovementInput = z.infer<typeof stockMovementSchema>
