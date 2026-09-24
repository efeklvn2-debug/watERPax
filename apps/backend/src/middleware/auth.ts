import { Request, Response, NextFunction } from 'express'
import { Role, Permission } from '@waterpax/types'
import { AppError } from './errorHandler'
import { prisma } from '../database'
import { verifyToken, JwtPayload } from '../auth'
import { createChildLogger } from '../logger'
import { getAccessTokenFromCookie } from '../cookies'

const logger = createChildLogger('auth:middleware')

export interface AuthUser {
  id: string
  username: string
  role: Role
  tenantId?: string
  tenantName?: string
  tenantSlug?: string
  totpEnabled?: boolean
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser
}

export async function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  let token: string | undefined

  const cookieToken = getAccessTokenFromCookie(req)
  if (cookieToken) {
    token = cookieToken
  } else {
    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7)
    }
  }

  if (!token) {
    return next(new AppError(401, 'UNAUTHORIZED', 'No token provided'))
  }

  let payload: JwtPayload
  try {
    payload = verifyToken(token)
  } catch (err) {
    logger.warn({ error: err }, 'JWT token validation failed')
    next(new AppError(401, 'UNAUTHORIZED', 'Invalid or expired token'))
    return
  }

  try {
    const internalUser = payload.userId
      ? await prisma.user.findUnique({ where: { id: payload.userId }, select: { id: true } })
      : null

    req.user = {
      id: internalUser?.id || payload.userId,
      username: payload.username,
      role: payload.role as Role,
      tenantId: payload.tenantId || undefined,
    }
    next()
  } catch (err) {
    next(err)
  }
}

export async function authenticateOptional(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const cookieToken = getAccessTokenFromCookie(req)
  const authHeader = req.headers.authorization
  const token = cookieToken || (authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined)
  if (!token) {
    return next()
  }
  try {
    const payload = verifyToken(token)
    req.user = {
      id: payload.userId,
      username: payload.username,
      role: payload.role as Role,
      tenantId: payload.tenantId || undefined,
    }
    next()
  } catch {
    next()
  }
}

export async function loadUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user?.id) {
    next()
    return
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        username: true,
        role: true,
        isActive: true,
        tenantId: true,
        totpEnabled: true,
        tenant: {
          select: {
            name: true,
            slug: true,
          }
        },
      }
    })

    if (!user || !user.isActive) {
      throw new AppError(401, 'UNAUTHORIZED', 'User not found or inactive')
    }

    req.user = {
      id: user.id,
      username: user.username,
      role: user.role as Role,
      tenantId: user.tenantId ?? undefined,
      tenantName: user.tenant?.name,
      tenantSlug: user.tenant?.slug,
      totpEnabled: user.totpEnabled,
    }
    next()
  } catch (err) {
    next(err)
  }
}

export async function checkUserPermission(userId: string, role: Role, permissionName: string): Promise<boolean> {
  // SUPER_ADMIN bypasses all permission checks
  if (role === Role.SUPER_ADMIN) return true

  const permission = await prisma.permission.findUnique({ where: { name: permissionName } })
  if (!permission) return false

  const rolePerm = await prisma.rolePermission.findUnique({
    where: { role_permissionId: { role, permissionId: permission.id } }
  })

  const userPerm = await prisma.userPermission.findUnique({
    where: { userId_permissionId: { userId, permissionId: permission.id } }
  })

  if (userPerm) return userPerm.granted

  return !!rolePerm
}

export async function getUserEffectivePermissions(userId: string, role: Role): Promise<string[]> {
  const dbPerms = await prisma.permission.findMany({
    include: {
      rolePermissions: { where: { role } },
      userPermissions: { where: { userId } }
    }
  })

  return dbPerms
    .filter((p: any) => {
      const roleMatch = p.rolePermissions.length > 0
      const userOverride = p.userPermissions.find((u: any) => u.userId === userId)
      if (userOverride) return userOverride.granted
      return roleMatch
    })
    .map((p: any) => p.name)
}

export function requirePermission(permissionName: Permission) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, 'UNAUTHORIZED', 'Authentication required'))
    }

    try {
      const has = await checkUserPermission(req.user.id, req.user.role, permissionName)
      if (!has) {
        return next(new AppError(403, 'FORBIDDEN', `Permission denied: ${permissionName}`))
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}
