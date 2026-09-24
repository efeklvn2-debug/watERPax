import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { createChildLogger } from './logger'

const logger = createChildLogger('auth')

const JWT_SECRET: string = process.env.JWT_SECRET as string
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required')
}

const ACCESS_TOKEN_EXPIRY = '15m'
const REFRESH_TOKEN_EXPIRY = '7d'
const POST_AUTH_TOKEN_EXPIRY = '5m'

export interface JwtPayload {
  userId: string
  username: string
  role: string
  tenantId?: string | null
  purpose?: 'TWO_FA'
}

export function generateAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY })
}

export function generateRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY, jwtid: crypto.randomUUID() })
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as unknown as JwtPayload
}

export function generateTokens(payload: JwtPayload): { accessToken: string; refreshToken: string } {
  logger.info({ userId: payload.userId, username: payload.username }, 'Tokens generated')
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload),
  }
}

export function generatePostAuthToken(payload: JwtPayload): string {
  return jwt.sign({ ...payload, purpose: 'TWO_FA' }, JWT_SECRET, { expiresIn: POST_AUTH_TOKEN_EXPIRY })
}
