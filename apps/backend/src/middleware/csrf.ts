import { Request, Response, NextFunction } from 'express'
import { AppError } from './errorHandler'
import { verifyCsrf, setCsrfCookie, CSRF_HEADER_NAME, COOKIE_NAMES } from '../cookies'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const CSRF_EXEMPT_PATHS = [
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/2fa/setup',
  '/api/auth/2fa/enroll',
  '/api/auth/2fa/verify-login',
  '/api/csp/report',
]

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) {
    return next()
  }

  const path = (req.originalUrl || req.url || '').split('?')[0]
  if (CSRF_EXEMPT_PATHS.some(p => path === p)) {
    return next()
  }

  if (!verifyCsrf(req)) {
    return next(new AppError(403, 'CSRF_INVALID', 'CSRF token missing or invalid'))
  }

  next()
}

function ensureCsrfCookie(req: Request, res: Response) {
  const existing = (req as any).cookies?.[COOKIE_NAMES.CSRF]
  if (!existing) {
    setCsrfCookie(res, req)
  }
}

export { CSRF_HEADER_NAME }
