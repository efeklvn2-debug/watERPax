import { z } from 'zod'

export const createAccountSchema = z.object({
  // Optional when parentId is a cash/bank parent (1000/1100) — the service
  // auto-generates 1000-XXX / 1100-XXX from the name in that case.
  code: z.string().min(1, 'Code is required').optional(),
  name: z.string().min(1, 'Name is required'),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'COGS']),
  parentId: z.string().optional(),
  isVatEnabled: z.boolean().optional(),
  isCashAccount: z.boolean().optional(),
  description: z.string().optional()
})

export const journalLineSchema = z.object({
  accountId: z.string().min(1, 'Account is required'),
  debit: z.number().min(0, 'Debit cannot be negative'),
  credit: z.number().min(0, 'Credit cannot be negative'),
  memo: z.string().optional()
}).refine(
  line => (line.debit > 0) !== (line.credit > 0),
  { message: 'A line cannot have both debit and credit' }
)

export const postJournalEntrySchema = z.object({
  description: z.string().min(1, 'Description is required'),
  sourceModule: z.string().min(1, 'Source module is required'),
  sourceId: z.string().optional(),
  reference: z.string().optional(),
  date: z.string().optional(),
  lines: z.array(journalLineSchema).min(2, 'Journal entry must have at least 2 lines')
})

export type CreateAccountInput = z.infer<typeof createAccountSchema>
export type PostJournalEntryInput = z.infer<typeof postJournalEntrySchema>
