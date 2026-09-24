import { Role } from '@waterpax/types'

export interface UserEntity {
  id: string
  username: string
  passwordHash: string
  role: Role
  isActive: boolean
  failedLoginAttempts: number
  lockedUntil: Date | null
  totpSecret: string | null
  totpEnabled: boolean
  totpRecoveryCodes: string | null
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
  tenantId: string | null
  tenant?: {
    id: string
    name: string
    slug: string
    isActive: boolean
  } | null
}

export interface UserResponse {
  id: string
  username: string
  role: Role
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  tenantId?: string | null
  tenantName?: string
  tenantSlug?: string
  totpEnabled?: boolean
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export type LoginChallenge = '2FA' | '2FA_ENROLL'

export type LoginResult =
  | { kind: 'success'; user: UserResponse; tokens: AuthTokens }
  | { kind: 'challenge'; challenge: LoginChallenge; postAuthToken: string }
