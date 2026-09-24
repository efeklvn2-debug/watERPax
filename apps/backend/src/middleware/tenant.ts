import { Response, NextFunction } from 'express'
import { AuthenticatedRequest } from './auth'
import { AppError } from './errorHandler'
import { prisma } from '../database'
import { runWithTenant, getCurrentTenantId } from '../context'

export interface TenantRequest extends AuthenticatedRequest {
  tenant?: {
    id: string
    slug: string
    name: string
  }
}

/**
 * Fail-closed guard for tenant-scoped routers: SUPER_ADMIN has no tenant and
 * must never execute tenant queries (tenantMiddleware would otherwise pass
 * them through with no tenant context). Mount after loadUser, before
 * tenantMiddleware: `router.use(authenticate, loadUser, requireTenantUser, tenantMiddleware)`.
 * Guide Angel keeps its own stricter requireTenantAdmin (ADMIN-only); platform
 * and auth routers must NOT use this guard.
 */
export function requireTenantUser(req: TenantRequest, res: Response, next: NextFunction) {
  if (req.user?.role === 'SUPER_ADMIN') {
    return next(new AppError(403, 'FORBIDDEN', 'Super admin accounts cannot access tenant data directly. Use the platform support route for the target tenant.'))
  }
  next()
}

/**
 * Explicit tenant id for write payloads. The Prisma $extends hook also
 * injects tenantId at runtime, but passing it explicitly keeps `tsc`
 * honest and fails closed (400, not silent cross-tenant write) when
 * async-local context is missing.
 */
export function requireTenantId(): string {
  const tenantId = getCurrentTenantId()
  if (!tenantId) {
    throw new AppError(400, 'TENANT_REQUIRED', 'No tenant associated with this user')
  }
  return tenantId
}

export async function tenantMiddleware(req: TenantRequest, res: Response, next: NextFunction) {
  if (!req.user?.id) {
    next()
    return
  }

  if (req.user.role === 'SUPER_ADMIN') {
    next()
    return
  }

  const tenantId = (req.user as any).tenantId
  if (!tenantId) {
    return next(new AppError(400, 'TENANT_REQUIRED', 'No tenant associated with this user'))
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, slug: true, name: true, isActive: true },
  })

  if (!tenant || !tenant.isActive) {
    return next(new AppError(403, 'TENANT_INACTIVE', 'Your organization is inactive or not found'))
  }

  req.tenant = { id: tenant.id, slug: tenant.slug, name: tenant.name }

  runWithTenant(tenant.id, () => {
    next()
  })
}
