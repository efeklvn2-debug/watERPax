import { z } from 'zod'

export const saleLineSchema = z.object({
  variantId: z.string().trim().min(1, 'Variant is required'),
  qty: z.number().int().positive('Quantity must be a positive whole number of packs'),
  // VAT-inclusive per pack. Defaults to the variant price; a custom value
  // requires the sales:discount permission (enforced in service).
  unitPrice: z.number().finite().min(0).optional(),
  isRefill: z.boolean().optional()
})

export const createSaleSchema = z.object({
  customerId: z.string().trim().min(1, 'Customer is required'),
  lines: z.array(saleLineSchema).min(1, 'At least one line is required').max(200),
  notes: z.string().trim().max(1000).optional(),
  saleType: z.enum(['OUTRIGHT', 'REFILL']).optional(),
  emptyBrought: z.number().int().min(0).optional()
})

export const updateLinePriceSchema = z.object({
  unitPrice: z.number().finite().min(0, 'Price must be zero or more')
})

export const deliverPaymentSchema = z.object({
  method: z.enum(['CASH', 'BANK_TRANSFER']),
  amount: z.number().positive('Payment amount must be positive').optional(),
  reference: z.string().trim().max(120).optional(),
  bankAccountId: z.string().trim().min(1).optional()
})

export const deliverSaleSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  notes: z.string().trim().max(1000).optional(),
  payment: deliverPaymentSchema.optional()
})

export const recordPaymentSchema = z.object({
  amount: z.number().positive('Payment amount must be positive'),
  method: z.enum(['CASH', 'BANK_TRANSFER']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  reference: z.string().trim().max(120).optional(),
  bankAccountId: z.string().trim().min(1).optional(),
  notes: z.string().trim().max(500).optional()
})

export const recordDepositSchema = z.object({
  customerId: z.string().trim().min(1, 'Customer is required'),
  amount: z.number().positive('Deposit amount must be positive'),
  method: z.enum(['CASH', 'BANK_TRANSFER']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  reference: z.string().trim().max(120).optional(),
  bankAccountId: z.string().trim().min(1).optional(),
  notes: z.string().trim().max(500).optional()
})

export const cancelSaleSchema = z.object({
  reason: z.string().trim().max(500).optional()
})

export const customerCreditNoteSchema = z.object({
  customerId: z.string().trim().min(1, 'Customer is required'),
  saleId: z.string().trim().min(1).optional(),
  variantId: z.string().trim().min(1, 'Variant is required'),
  quantity: z.number().int().positive('Quantity must be positive'),
  reason: z.string().trim().min(1, 'Reason is required'),
  disposition: z.enum(['RESTOCK', 'SCRAP']),
  refundMethod: z.enum(['CREDIT', 'CASH', 'BANK']).default('CREDIT'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  notes: z.string().trim().max(1000).optional(),
  bankAccountId: z.string().trim().min(1).optional()
})

export type CreateSaleInput = z.infer<typeof createSaleSchema>
export type UpdateLinePriceInput = z.infer<typeof updateLinePriceSchema>
export type DeliverSaleInput = z.infer<typeof deliverSaleSchema>
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>
export type RecordDepositInput = z.infer<typeof recordDepositSchema>
export type CancelSaleInput = z.infer<typeof cancelSaleSchema>
export type CustomerCreditNoteInput = z.infer<typeof customerCreditNoteSchema>
