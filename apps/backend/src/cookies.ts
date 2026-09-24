import { Request, Response } from 'express'
import crypto from 'crypto'

const ACCESS_TOKEN_COOKIE = 'waterpax_at'
const REFRESH_TOKEN_COOKIE = 'waterpax_rt'
const CSRF_COOKIE = 'waterpax_csrf'
const CSRF_HEADER = 'x-waterpax-csrf'

const ACCESS_TOKEN_MAX_AGE_MS = 15 * 60 * 1000
const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const CSRF_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function isHttps(req?: Request): boolean {
  if (req) {
    if (req.secure) return true
    const forwarded = req.headers['x-forwarded-proto']
    if (typeof forwarded === 'string' && forwarded.toLowerCase() === 'https') return true
    if (Array.isArray(forwarded) && forwarded.some(p => p.toLowerCase() === 'https')) return true
    return false
  }
  return process.env.COOKIE_SECURE === 'true'
}

function cookieBaseOptions(maxAgeMs: number, req?: Request) {
  return {
    httpOnly: true,
    secure: isHttps(req),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeMs,
  }
}

export function setAuthCookies(req: Request, res: Response, accessToken: string, refreshToken: string) {
  res.cookie(ACCESS_TOKEN_COOKIE, accessToken, cookieBaseOptions(ACCESS_TOKEN_MAX_AGE_MS, req))
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, cookieBaseOptions(REFRESH_TOKEN_MAX_AGE_MS, req))
  setCsrfCookie(res, req)
}

export function setAccessTokenCookie(req: Request, res: Response, accessToken: string, refreshToken: string) {
  res.cookie(ACCESS_TOKEN_COOKIE, accessToken, cookieBaseOptions(ACCESS_TOKEN_MAX_AGE_MS, req))
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, cookieBaseOptions(REFRESH_TOKEN_MAX_AGE_MS, req))
}

export function clearAuthCookies(res: Response) {
  const opts = { path: '/' }
  res.clearCookie(ACCESS_TOKEN_COOKIE, opts)
  res.clearCookie(REFRESH_TOKEN_COOKIE, opts)
  res.clearCookie(CSRF_COOKIE, opts)
}

export function setCsrfCookie(res: Response, req?: Request) {
  const token = crypto.randomBytes(32).toString('hex')
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: isHttps(req),
    sameSite: 'lax',
    path: '/',
    maxAge: CSRF_MAX_AGE_MS,
  })
  return token
}

export function getAccessTokenFromCookie(req: Request): string | undefined {
  return (req as any).cookies?.[ACCESS_TOKEN_COOKIE]
}

export function getRefreshTokenFromCookie(req: Request): string | undefined {
  return (req as any).cookies?.[REFRESH_TOKEN_COOKIE]
}

export function verifyCsrf(req: Request): boolean {
  const cookieToken = (req as any).cookies?.[CSRF_COOKIE]
  const headerToken = req.headers[CSRF_HEADER] as string | undefined
  if (!cookieToken || !headerToken) return false
  if (cookieToken.length !== headerToken.length) return false
  return crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))
}

export const COOKIE_NAMES = {
  ACCESS_TOKEN: ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN: REFRESH_TOKEN_COOKIE,
  CSRF: CSRF_COOKIE,
}

export const CSRF_HEADER_NAME = CSRF_HEADER
