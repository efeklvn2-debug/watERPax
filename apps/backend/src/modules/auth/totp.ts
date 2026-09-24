import { generateSecret, generateURI, verifySync } from 'otplib'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

export function generateTotpSecret(): string {
  return generateSecret()
}

export function buildOtpauthUrl(username: string, secret: string): string {
  return generateURI({ issuer: 'WatERPax', label: username, secret, strategy: 'totp' })
}

export function verifyTotpCode(secret: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false
  try {
    const result = verifySync({ strategy: 'totp', secret, token: code, epochTolerance: [30, 30] })
    return result.valid
  } catch {
    return false
  }
}

const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const RECOVERY_CODE_COUNT = 10
const RECOVERY_CODE_LENGTH = 8

export async function generateRecoveryCodes(): Promise<{ codes: string[]; hashes: string[] }> {
  const codes: string[] = []
  const hashes: string[] = []
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const randomBytes = crypto.randomBytes(RECOVERY_CODE_LENGTH)
    let code = ''
    for (let j = 0; j < RECOVERY_CODE_LENGTH; j++) {
      code += RECOVERY_CODE_ALPHABET[randomBytes[j] % RECOVERY_CODE_ALPHABET.length]
    }
    code = `${code.slice(0, 4)}-${code.slice(4)}`
    codes.push(code)
    hashes.push(await bcrypt.hash(code, 12))
  }
  return { codes, hashes }
}

export function parseRecoveryCodeHashes(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === 'string') : []
  } catch {
    return []
  }
}

export async function verifyRecoveryCode(candidate: string, storedHashes: string[]): Promise<boolean> {
  const normalized = candidate.trim().toUpperCase()
  for (const hash of storedHashes) {
    if (await bcrypt.compare(normalized, hash)) return true
  }
  return false
}

export async function removeRecoveryCode(candidate: string, storedHashes: string[]): Promise<string[]> {
  const normalized = candidate.trim().toUpperCase()
  const remaining: string[] = []
  let removed = false
  for (const hash of storedHashes) {
    if (!removed && (await bcrypt.compare(normalized, hash))) {
      removed = true
      continue
    }
    remaining.push(hash)
  }
  return remaining
}