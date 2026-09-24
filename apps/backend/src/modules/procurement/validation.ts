import { z } from 'zod'

export const poLineItemSchema = z.object({
  materialId: z.string().min(1, 'Material is required'),
  quantity: z.number().positive('Quantity must be positive'),
  unitPrice: z.number().min(0, 'Unit price cannot be negative'),
  totalWeight: z.number().positive().optional()
})

export const purchaseOrderSchema = z.object({
  supplier: z.string().min(1, 'Supplier is required'),
  expectedDate: z.string().optional(),
  issuedDate: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(poLineItemSchema).min(1, 'At least one line item is required')
})

export const addLineItemSchema = poLineItemSchema

export const updatePOSchema = z.object({
  supplier: z.string().min(1, 'Supplier is required').optional(),
  expectedDate: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(poLineItemSchema).optional()
})

export const receivePOSchema = z.object({
  date: z.string().optional(),
  receivedLines: z.array(z.object({
    lineItemId: z.string().min(1),
    receivedQty: z.number().min(0, 'Received quantity cannot be negative')
  })).optional(),
  invoice: z.object({
    amount: z.number().positive('Invoice amount must be positive'),
    date: z.string().min(1, 'Invoice date is required'),
    invoiceNumber: z.string().optional()
  }).optional()
})

export const creditNoteSchema = z.object({
  supplierId: z.string().min(1, 'Supplier is required'),
  poId: z.string().optional(),
  amount: z.number().positive('Credit amount must be positive'),
  date: z.string().min(1, 'Date is required'),
  reason: z.string().min(1, 'Reason is required'),
  materialId: z.string().optional(),
  quantity: z.number().positive().optional(),
  notes: z.string().optional()
})

export const supplierInvoiceSchema = z.object({
  poId: z.string().min(1, 'PO is required'),
  date: z.string().min(1, 'Date is required'),
  amount: z.number().positive('Amount must be positive'),
  invoiceNumber: z.string().optional()
})

export const supplierPaymentSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  date: z.string().optional(),
  paymentMethod: z.enum(['Cash', 'Bank Transfer']).optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
  bankAccountId: z.string().optional()
})

export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>
export type POLineItemInput = z.infer<typeof poLineItemSchema>
export type AddLineItemInput = z.infer<typeof addLineItemSchema>
export type UpdatePOInput = z.infer<typeof updatePOSchema>
export type ReceivePOInput = z.infer<typeof receivePOSchema>
export type CreditNoteInput = z.infer<typeof creditNoteSchema>
export type SupplierInvoiceInput = z.infer<typeof supplierInvoiceSchema>
export type SupplierPaymentInput = z.infer<typeof supplierPaymentSchema>
