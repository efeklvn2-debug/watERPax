import bcrypt from 'bcryptjs'
import { authRepository } from './repository'
import { LoginInput, RegisterInput, UpdateUserInput, SetRolePermissionsInput, SetUserPermissionOverridesInput, ChangePasswordInput, TotpEnrollInput, VerifyLogin2faInput, Disable2faInput } from './validation'
import { LoginResult, UserResponse, AuthTokens } from './types'
import { Role } from '@waterpax/types'
import { AppError } from '../../middleware/errorHandler'
import { createChildLogger } from '../../logger'
import { prisma } from '../../database'
import { generateTokens, generatePostAuthToken, verifyToken, JwtPayload } from '../../auth'
import {
  generateTotpSecret,
  buildOtpauthUrl,
  verifyTotpCode,
  generateRecoveryCodes,
  parseRecoveryCodeHashes,
  verifyRecoveryCode,
  removeRecoveryCode,
} from './totp'

const logger = createChildLogger('auth:service')

const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10)
const LOCKOUT_MS = parseFloat(process.env.LOCKOUT_MINUTES || '10') * 60 * 1000
const LOGIN_DELAY_MS = parseInt(process.env.LOGIN_DELAY_MS || '400', 10)
const TOTP_PENDING_TTL_MS = 10 * 60 * 1000
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000
const REFRESH_GRACE_MS = 60 * 1000

const totpPending = new Map<string, { secret: string; expiresAt: number }>()

async function persistUserRefreshToken(userId: string, tenantId: string | null | undefined, refreshToken: string): Promise<void> {
  await authRepository.deleteUserRefreshTokens(userId)
  await authRepository.createRefreshToken({
    token: refreshToken,
    userId,
    tenantId: tenantId ?? undefined,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function toUserResponse(user: any): UserResponse {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    tenantId: user.tenantId,
    tenantName: user.tenant?.name,
    tenantSlug: user.tenant?.slug,
    totpEnabled: user.totpEnabled,
  }
}

async function resolvePostAuthUser(postAuthToken: string) {
  let payload: JwtPayload & { purpose?: string }
  try {
    payload = verifyToken(postAuthToken)
  } catch {
    throw new AppError(401, 'INVALID_TOKEN', 'Post-auth token invalid or expired. Please sign in again.')
  }
  if (payload.purpose !== 'TWO_FA') {
    throw new AppError(401, 'INVALID_TOKEN', 'Post-auth token invalid or expired. Please sign in again.')
  }
  const user = await authRepository.findUserById(payload.userId)
  if (!user || !user.isActive) {
    throw new AppError(401, 'UNAUTHORIZED', 'User not found or inactive')
  }
  return user
}

async function recordFailedAttempt(userId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true }
    })
    if (updated.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS) {
      await tx.user.update({
        where: { id: userId },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: new Date(Date.now() + LOCKOUT_MS)
        }
      })
    }
    return updated.failedLoginAttempts
  })
}

export const authService = {
  async login(input: LoginInput): Promise<LoginResult> {
    const user = await authRepository.findUserByUsername(input.username)

    if (!user) {
      await sleep(Math.min(LOGIN_DELAY_MS, 2000))
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password')
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError(401, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again in a few minutes.')
    }

    if (!user.isActive) {
      throw new AppError(401, 'ACCOUNT_INACTIVE', 'Account is inactive')
    }

    if (user.role !== 'SUPER_ADMIN' && (!user.tenant || !user.tenant.isActive)) {
      throw new AppError(403, 'TENANT_INACTIVE', 'Your organization is inactive')
    }

    const isValidPassword = await bcrypt.compare(input.password, user.passwordHash)
    if (!isValidPassword) {
      const attempts = await recordFailedAttempt(user.id)
      const delay = Math.min(LOGIN_DELAY_MS + attempts * 100 + Math.random() * 50, 2000)
      await sleep(delay)
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password')
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null }
    })

    const payload: JwtPayload = {
      userId: user.id,
      username: user.username,
      role: user.role,
      tenantId: user.tenantId,
    }

    if (user.totpEnabled) {
      logger.info({ userId: user.id }, '2FA challenge issued after password verification')
      return {
        kind: 'challenge',
        challenge: '2FA',
        postAuthToken: generatePostAuthToken(payload),
      }
    }

    // 2FA enrollment temporarily disabled for super admin (will re-enable later)
    // if (user.role === 'SUPER_ADMIN') {
    //   logger.info({ userId: user.id }, '2FA enrollment required for super admin')
    //   return {
    //     kind: 'challenge',
    //     challenge: '2FA_ENROLL',
    //     postAuthToken: generatePostAuthToken(payload),
    //   }
    // }

    const tokens = generateTokens(payload)

    await persistUserRefreshToken(user.id, user.tenantId, tokens.refreshToken)

    logger.info({ userId: user.id, username: user.username, tenantId: user.tenantId }, 'User logged in')

    return {
      kind: 'success',
      user: toUserResponse(user),
      tokens,
    }
  },

  // â”€â”€ 2FA (TOTP) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async setup2fa(sessionUserId: string | undefined, postAuthToken?: string): Promise<{ secret: string; otpauthUrl: string }> {
    const userId = sessionUserId || (await resolvePostAuthUser(postAuthToken!)).id
    const user = await authRepository.findUserById(userId)
    if (!user || !user.isActive) throw new AppError(401, 'UNAUTHORIZED', 'User not found or inactive')
    if (user.totpEnabled) throw new AppError(400, 'TOTP_ALREADY_ENABLED', 'Two-factor authentication is already enabled')

    const secret = generateTotpSecret()
    totpPending.set(userId, { secret, expiresAt: Date.now() + TOTP_PENDING_TTL_MS })
    return { secret, otpauthUrl: buildOtpauthUrl(user.username, secret) }
  },

  async enroll2fa(sessionUserId: string | undefined, postAuthToken: string | undefined, input: TotpEnrollInput): Promise<{ recoveryCodes: string[]; user: UserResponse }> {
    const userId = sessionUserId || (await resolvePostAuthUser(postAuthToken!)).id
    if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required')
    const user = await authRepository.findUserById(userId)
    if (!user || !user.isActive) throw new AppError(401, 'UNAUTHORIZED', 'User not found or inactive')
    if (user.totpEnabled) throw new AppError(400, 'TOTP_ALREADY_ENABLED', 'Two-factor authentication is already enabled')

    const pending = totpPending.get(userId)
    if (!pending || pending.expiresAt < Date.now()) {
      totpPending.delete(userId)
      throw new AppError(400, 'TOTP_SETUP_EXPIRED', 'Setup session expired. Please start again.')
    }

    if (!verifyTotpCode(pending.secret, input.code)) {
      throw new AppError(400, 'INVALID_2FA_CODE', 'Invalid verification code')
    }

    const { codes, hashes } = await generateRecoveryCodes()
    await prisma.user.update({
      where: { id: userId },
      data: {
        totpSecret: pending.secret,
        totpEnabled: true,
        totpRecoveryCodes: JSON.stringify(hashes),
      },
    })
    totpPending.delete(userId)
    logger.info({ userId }, 'Two-factor authentication enabled')

    const updated = await authRepository.findUserById(userId)
    return { recoveryCodes: codes, user: toUserResponse(updated) }
  },

  async issueTokensForUser(userId: string): Promise<AuthTokens> {
    const user = await authRepository.findUserById(userId)
    if (!user || !user.isActive) throw new AppError(401, 'UNAUTHORIZED', 'User not found or inactive')
    const payload: JwtPayload = {
      userId: user.id,
      username: user.username,
      role: user.role,
      tenantId: user.tenantId,
    }
    const tokens = generateTokens(payload)
    await persistUserRefreshToken(user.id, user.tenantId, tokens.refreshToken)
    return tokens
  },

  async verifyLogin2fa(postAuthToken: string, input: Omit<VerifyLogin2faInput, 'postAuthToken'>): Promise<{ user: UserResponse; tokens: AuthTokens }> {
    const user = await resolvePostAuthUser(postAuthToken)
    if (!user.totpEnabled) throw new AppError(400, 'TOTP_NOT_ENABLED', 'Two-factor authentication is not enabled for this account')

    const code = input.code?.trim() || ''
    const recoveryCode = input.recoveryCode?.trim() || ''
    if (!code && !recoveryCode) {
      throw new AppError(400, 'CODE_REQUIRED', 'A verification code or recovery code is required')
    }

    const storedHashes = parseRecoveryCodeHashes(user.totpRecoveryCodes)
    let usedRecovery = false

    if (user.totpSecret && code && verifyTotpCode(user.totpSecret, code)) {
      // valid TOTP
    } else if (recoveryCode && (await verifyRecoveryCode(recoveryCode, storedHashes))) {
      usedRecovery = true
    } else {
      throw new AppError(401, 'INVALID_2FA_CODE', 'Invalid verification code')
    }

    if (usedRecovery && storedHashes.length > 0) {
      const remaining = await removeRecoveryCode(recoveryCode, storedHashes)
      await prisma.user.update({
        where: { id: user.id },
        data: { totpRecoveryCodes: JSON.stringify(remaining) },
      })
    }

    const payload: JwtPayload = {
      userId: user.id,
      username: user.username,
      role: user.role,
      tenantId: user.tenantId,
    }
    const tokens = generateTokens(payload)
    await persistUserRefreshToken(user.id, user.tenantId, tokens.refreshToken)
    logger.info({ userId: user.id, usedRecovery }, '2FA verification passed â€” user logged in')

    const fresh = await authRepository.findUserById(user.id)
    return { user: toUserResponse(fresh), tokens }
  },

  async disable2fa(userId: string, input: Disable2faInput): Promise<void> {
    const user = await authRepository.findUserById(userId)
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found')
    if (!user.totpEnabled) throw new AppError(400, 'TOTP_NOT_ENABLED', 'Two-factor authentication is not enabled')

    const code = input.code.trim()
    const storedHashes = parseRecoveryCodeHashes(user.totpRecoveryCodes)
    const totpOk = !!user.totpSecret && verifyTotpCode(user.totpSecret, code)
    const recoveryOk = await verifyRecoveryCode(code, storedHashes)
    if (!totpOk && !recoveryOk) {
      throw new AppError(401, 'INVALID_2FA_CODE', 'Invalid verification code')
    }

    await prisma.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpEnabled: false, totpRecoveryCodes: null },
    })
    totpPending.delete(userId)
    logger.info({ userId }, 'Two-factor authentication disabled')
  },

  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    let payload: JwtPayload
    try {
      payload = verifyToken(refreshToken)
    } catch {
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid or expired refresh token')
    }

    const stored = await authRepository.findRefreshToken(refreshToken)
    if (!stored || stored.userId !== payload.userId) {
      const issuedAt = typeof (payload as any).iat === 'number' ? new Date((payload as any).iat * 1000) : new Date(0)
      const recent = await authRepository.findRecentRefreshToken(payload.userId, issuedAt, REFRESH_GRACE_MS)
      if (!recent) {
        throw new AppError(401, 'INVALID_TOKEN', 'Invalid or expired refresh token')
      }
    }

    const user = await authRepository.findUserById(payload.userId)
    if (!user || !user.isActive) {
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid or expired refresh token')
    }

    await authRepository.deleteExpiredRefreshTokens(user.id)

    const newPayload: JwtPayload = {
      userId: user.id,
      username: user.username,
      role: user.role,
      tenantId: user.tenantId,
    }

    const tokens = generateTokens(newPayload)
    await authRepository.createRefreshToken({
      token: tokens.refreshToken,
      userId: user.id,
      tenantId: user.tenantId ?? undefined,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    })
    await authRepository.deleteRefreshToken(refreshToken)

    return tokens
  },

  async register(input: RegisterInput, tenantId: string): Promise<UserResponse> {
    const passwordHash = await bcrypt.hash(input.password, 12)

    try {
      const user = await authRepository.createUser({
        username: input.username,
        passwordHash,
        role: (input.role ?? Role.OPERATOR) as Role,
        tenantId,
      })

      logger.info({ userId: user.id, username: user.username }, 'User registered')

      return {
        id: user.id,
        username: user.username,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new AppError(409, 'USER_EXISTS', 'Username already taken')
      }
      throw error
    }
  },

  async logout(refreshToken: string): Promise<void> {
    try {
      const payload = verifyToken(refreshToken)
      await authRepository.deleteUserRefreshTokens(payload.userId)
      logger.info({ userId: payload.userId }, 'User logged out')
    } catch {
      logger.info('Logout with invalid token')
    }
  },

  // â”€â”€ Admin: User management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async listUsers() {
    const users = await authRepository.listUsers()
    const overrideCounts = await Promise.all(
      users.map(u =>
        authRepository.getUserPermissionOverrides(u.id).then(ov => ov.length)
      )
    )
    return users.map((u, i) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      isActive: u.isActive,
      createdAt: u.createdAt,
      overrideCount: overrideCounts[i]
    }))
  },

  async getUserDetail(id: string) {
    const user = await authRepository.findUserById(id)
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found')
    const overrides = await authRepository.getUserPermissionOverrides(id)
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      overrides: overrides.map(o => ({
        id: o.id,
        permissionId: o.permissionId,
        permissionName: o.permission.name,
        granted: o.granted
      }))
    }
  },

  async updateUser(id: string, input: UpdateUserInput) {
    const updated = await prisma.user.updateMany({
      where: { id },
      data: input as any
    })
    if (updated.count === 0) throw new AppError(404, 'NOT_FOUND', 'User not found')
    if (input.role !== undefined || input.isActive !== undefined) {
      await authRepository.deleteUserRefreshTokens(id)
      logger.info({ userId: id, role: input.role }, 'User role/status change â€” refresh tokens cycled')
    }
    const user = await authRepository.findUserById(id)
    return {
      id: user!.id,
      username: user!.username,
      role: user!.role,
      isActive: user!.isActive
    }
  },

  // â”€â”€ Admin: Permission management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async listPermissions() {
    const perms = await authRepository.listPermissions()
    return perms.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      module: p.module
    }))
  },

  async listRolesWithCounts() {
    const roles: Role[] = [Role.ADMIN, Role.MANAGER, Role.OPERATOR, Role.VIEWER]
    const counts = await Promise.all(
      roles.map(async role => {
        const ids = await authRepository.getRolePermissionIds(role)
        return { role, permissionCount: ids.length }
      })
    )
    return counts
  },

  async getRolePermissions(role: Role) {
    return authRepository.getRolePermissionIds(role)
  },

  async setRolePermissions(role: Role, input: SetRolePermissionsInput) {
    const count = await authRepository.setRolePermissions(role, input.permissionIds)
    logger.info({ role, count }, 'Role permissions updated')
    return { count }
  },

  async getUserPermissionOverrides(userId: string) {
    const user = await authRepository.findUserById(userId)
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found')
    return authRepository.getUserPermissionOverrides(userId)
  },

  async setUserPermissionOverrides(userId: string, input: SetUserPermissionOverridesInput) {
    const user = await authRepository.findUserById(userId)
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found')
    const count = await authRepository.setUserPermissionOverrides(userId, input.overrides)
    logger.info({ userId, count }, 'User permission overrides updated')
    return { count }
  },

  async deleteUserPermissionOverride(userId: string, permissionId: string) {
    const user = await authRepository.findUserById(userId)
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found')
    await authRepository.deleteUserPermissionOverride(userId, permissionId)
  },

  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    const user = await authRepository.findUserById(userId)
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found')

    const isValid = await bcrypt.compare(input.currentPassword, user.passwordHash)
    if (!isValid) throw new AppError(400, 'INVALID_PASSWORD', 'Current password is incorrect')

    const newPasswordHash = await bcrypt.hash(input.newPassword, 12)

    await authRepository.updateUser(userId, { passwordHash: newPasswordHash })

    await authRepository.deleteUserRefreshTokens(userId)
    logger.info({ userId }, 'Password changed')
  }
}
