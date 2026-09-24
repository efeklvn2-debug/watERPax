import { z } from 'zod'

export const createTenantSchema = z.object({
  name: z.string().min(2, 'Tenant name must be at least 2 characters'),
  slug: z.string().min(2, 'Slug must be at least 2 characters').regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only'),
})

export const createTenantUserSchema = z.object({
  username: z.string().email('Valid email is required'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  role: z.enum(['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER']).default('ADMIN'),
})

export const updateTenantSchema = z.object({
  name: z.string().min(2).optional(),
  isActive: z.boolean().optional(),
})

export type CreateTenantInput = z.infer<typeof createTenantSchema>
export type CreateTenantUserInput = z.infer<typeof createTenantUserSchema>
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>
