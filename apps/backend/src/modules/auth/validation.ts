import { z } from 'zod'

export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required')
})

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required').optional()
})

export const registerSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  role: z.enum(['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER']).optional()
})

export const updateUserSchema = z.object({
  role: z.enum(['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER']).optional(),
  isActive: z.boolean().optional()
})

export const setRolePermissionsSchema = z.object({
  permissionIds: z.array(z.string().min(1)).min(0)
})

export const setUserPermissionOverridesSchema = z.object({
  overrides: z.array(z.object({
    permissionId: z.string().min(1),
    granted: z.boolean()
  })).min(0)
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .regex(/[A-Z]/, 'New password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'New password must contain at least one number'),
})

export const postAuthTokenSchema = z.object({
  postAuthToken: z.string().min(1, 'Post-auth token is required'),
})

export const totpSetupSchema = z.object({
  postAuthToken: z.string().min(1, 'Post-auth token is required').optional(),
})

export const totpEnrollSchema = z.object({
  postAuthToken: z.string().min(1, 'Post-auth token is required').optional(),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
})

export const verifyLogin2faSchema = z.object({
  postAuthToken: z.string().min(1, 'Post-auth token is required'),
  code: z.string().min(1, 'Code is required').optional(),
  recoveryCode: z.string().min(1, 'Recovery code is required').optional(),
})

export const disable2faSchema = z.object({
  code: z.string().min(1, 'Code is required'),
})

export type LoginInput = z.infer<typeof loginSchema>
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>
export type SetRolePermissionsInput = z.infer<typeof setRolePermissionsSchema>
export type SetUserPermissionOverridesInput = z.infer<typeof setUserPermissionOverridesSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
export type PostAuthTokenInput = z.infer<typeof postAuthTokenSchema>
export type TotpEnrollInput = z.infer<typeof totpEnrollSchema>
export type VerifyLogin2faInput = z.infer<typeof verifyLogin2faSchema>
export type Disable2faInput = z.infer<typeof disable2faSchema>
