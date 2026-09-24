import { z } from 'zod'

const nonNegative = z.number().finite().min(0)

const bankSchema = z.object({
  name: z.string().trim().min(1, 'Bank name is required'),
  balance: nonNegative
})

const customerBalanceSchema = z.object({
  customerId: z.string().trim().min(1),
  receivableAmount: nonNegative,
  depositAmount: nonNegative,
  jarBalance: z.number().int().min(0).default(0)
})

const supplierBalanceSchema = z.object({
  supplierId: z.string().trim().min(1),
  payableAmount: nonNegative
})

const stockItemSchema = z.object({
  materialId: z.string().trim().min(1),
  quantity: nonNegative
})

export const guideAngelDraftSchema = z.object({
  goLiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Go-live date is required'),
  cashBalance: nonNegative,
  bankAccounts: z.array(bankSchema).max(100),
  loans: nonNegative,
  fixedAssets: nonNegative,
  accumulatedDepreciation: nonNegative,
  ownerCapital: nonNegative,
  customerBalances: z.array(customerBalanceSchema).max(5000),
  supplierBalances: z.array(supplierBalanceSchema).max(5000),
  stockItems: z.array(stockItemSchema).max(5000),
  supportReason: z.string().trim().max(500).optional()
})

export const guideAngelSaveSchema = z.object({
  draft: guideAngelDraftSchema
})

export const guideAngelCompleteSchema = z.object({
  confirm: z.literal(true),
  supportReason: z.string().trim().max(500).optional()
})

export const guideAngelSupportSaveSchema = guideAngelSaveSchema.extend({
  supportReason: z.string().trim().min(1, 'Support reason is required').max(500)
})

export const guideAngelSupportCompleteSchema = z.object({
  confirm: z.literal(true),
  supportReason: z.string().trim().min(1, 'Support reason is required').max(500)
})

export type GuideAngelDraftInput = z.infer<typeof guideAngelDraftSchema>
