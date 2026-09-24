import { z } from 'zod'

export const productCategorySchema = z.enum(['BOTTLED', 'SACHET', 'JAR'])

export const createProductSchema = z.object({
  code: z.string().trim().min(1, 'Product code is required').max(32),
  name: z.string().trim().min(1, 'Product name is required').max(120),
  category: productCategorySchema
})

export const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  isActive: z.boolean().optional()
})

export const createVariantSchema = z.object({
  label: z.string().trim().min(1, 'Variant label is required').max(64),
  packSize: z.number().int().positive('Pack size must be a positive whole number'),
  unitOfMeasure: z.string().trim().min(1).max(16).default('pack'),
  pricePerUnit: z.number().finite().min(0, 'Price must be zero or more'),
  refillPrice: z.number().finite().min(0).nullable().optional(),
  jarMaterialId: z.string().nullable().optional()
})

export const updateVariantSchema = z.object({
  label: z.string().trim().min(1).max(64).optional(),
  packSize: z.number().int().positive().optional(),
  unitOfMeasure: z.string().trim().min(1).max(16).optional(),
  pricePerUnit: z.number().finite().min(0).optional(),
  refillPrice: z.number().finite().min(0).nullable().optional(),
  jarMaterialId: z.string().nullable().optional(),
  isActive: z.boolean().optional()
})

export const bomLineSchema = z.object({
  materialId: z.string().trim().min(1, 'Material is required'),
  qtyPerPack: z.number().positive('Quantity per pack must be positive'),
  grammage: z.number().positive().optional(),
  wastagePct: z.number().min(0).max(100).default(0)
})

export const replaceBomSchema = z.object({
  lines: z.array(bomLineSchema).max(200)
})

export type CreateProductInput = z.infer<typeof createProductSchema>
export type UpdateProductInput = z.infer<typeof updateProductSchema>
export type CreateVariantInput = z.infer<typeof createVariantSchema>
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>
export type ReplaceBomInput = z.infer<typeof replaceBomSchema>
