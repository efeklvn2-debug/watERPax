import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { authController } from './controller'
import { validateRequest } from '../../middleware/validation'
import { authLimiter, registerLimiter, twoFactorLimiter, sensitiveLimiter } from '../../middleware/rateLimiters'
import { loginSchema, refreshTokenSchema, registerSchema, updateUserSchema, setRolePermissionsSchema, setUserPermissionOverridesSchema, changePasswordSchema, totpSetupSchema, totpEnrollSchema, verifyLogin2faSchema, disable2faSchema } from './validation'
import { authenticate, authenticateOptional, loadUser, requirePermission } from '../../middleware/auth'
import { tenantMiddleware } from '../../middleware/tenant'

export const authRouter = Router()

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.CI ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again in 15 minutes.' } }
})

authRouter.post(
  '/login',
  loginLimiter,
  validateRequest(loginSchema),
  authController.login
)

authRouter.post(
  '/refresh',
  authLimiter,
  validateRequest(refreshTokenSchema),
  authController.refreshToken
)

authRouter.post(
  '/register',
  registerLimiter,
  validateRequest(registerSchema),
  authenticate,
  loadUser,
  tenantMiddleware,
  requirePermission('auth:manage_users'),
  authController.register
)

authRouter.post(
  '/logout',
  authenticate,
  loadUser,
  tenantMiddleware,
  authController.logout
)

authRouter.get(
  '/me',
  authenticate,
  loadUser,
  tenantMiddleware,
  authController.me
)

authRouter.get(
  '/permissions',
  authenticate,
  loadUser,
  tenantMiddleware,
  authController.myPermissions
)

authRouter.patch(
  '/password',
  authenticate,
  loadUser,
  tenantMiddleware,
  validateRequest(changePasswordSchema),
  authController.changePassword
)

// ── Two-factor authentication (TOTP) ──────────────────────────────

authRouter.post(
  '/2fa/setup',
  twoFactorLimiter,
  validateRequest(totpSetupSchema),
  authenticateOptional,
  loadUser,
  authController.setup2fa
)

authRouter.post(
  '/2fa/enroll',
  twoFactorLimiter,
  validateRequest(totpEnrollSchema),
  authenticateOptional,
  loadUser,
  authController.enroll2fa
)

authRouter.post(
  '/2fa/verify-login',
  twoFactorLimiter,
  validateRequest(verifyLogin2faSchema),
  authController.verifyLogin2fa
)

authRouter.post(
  '/2fa/disable',
  sensitiveLimiter,
  authenticate,
  loadUser,
  tenantMiddleware,
  validateRequest(disable2faSchema),
  authController.disable2fa
)

// ── Admin: User & Permission Management ─────────────────────────

authRouter.get(
  '/users',
  authenticate,
  loadUser,
  tenantMiddleware,
  requirePermission('auth:manage_users'),
  authController.listUsers
)

authRouter.get(
  '/users/:id',
  authenticate,
  loadUser,
  tenantMiddleware,
  requirePermission('auth:manage_users'),
  authController.getUserDetail
)

authRouter.patch(
  '/users/:id',
  authenticate,
  loadUser,
  tenantMiddleware,
  requirePermission('auth:manage_users'),
  validateRequest(updateUserSchema),
  authController.updateUser
)

authRouter.get(
  '/permissions/all',
  authenticate,
  loadUser,
  tenantMiddleware,
  requirePermission('auth:manage_users'),
  authController.listAllPermissions
)

authRouter.get(
  '/roles',
  authenticate,
  loadUser,
  tenantMiddleware,
  requirePermission('auth:manage_users'),
  authController.listRoles
)

authRouter.get(
  '/roles/:role/permissions',
  authenticate,
  loadUser,
  tenantMiddleware,
  requirePermission('auth:manage_users'),
  authController.getRolePermissions
)

authRouter.put(
  '/roles/:role/permissions',
  authenticate,
  loadUser,
  tenantMiddleware,
  requirePermission('auth:manage_users'),
  validateRequest(setRolePermissionsSchema),
  authController.setRolePermissions
)

authRouter.get(
  '/users/:id/permissions',
  authenticate,
  loadUser,
  tenantMiddleware,
  requirePermission('auth:manage_users'),
  authController.getUserPermissionOverrides
)

authRouter.put(
  '/users/:id/permissions',
  authenticate,
  loadUser,
  tenantMiddleware,
  requirePermission('auth:manage_users'),
  validateRequest(setUserPermissionOverridesSchema),
  authController.setUserPermissionOverrides
)

authRouter.delete(
  '/users/:id/permissions/:permId',
  authenticate,
  loadUser,
  tenantMiddleware,
  requirePermission('auth:manage_users'),
  authController.deleteUserPermissionOverride
)
