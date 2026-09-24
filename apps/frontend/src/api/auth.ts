import { api } from './client'

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  user: {
    id: string
    username: string
    role: 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'VIEWER' | 'SUPER_ADMIN'
    isActive: boolean
    createdAt: string
    updatedAt: string
    tenantId?: string | null
    tenantName?: string
    tenantSlug?: string
    totpEnabled?: boolean
  }
}

export interface TotpSetupResult {
  secret: string
  otpauthUrl: string
}

export interface TotpEnrollResult {
  recoveryCodes: string[]
  user: LoginResponse['user']
}

export interface UserListItem {
  id: string
  username: string
  role: string
  isActive: boolean
  createdAt: string
  overrideCount: number
}

export interface PermissionInfo {
  id: string
  name: string
  description: string | null
  module: string | null
}

export interface UserOverride {
  id: string
  permissionId: string
  permissionName: string
  granted: boolean
}

export interface RoleInfo {
  role: string
  permissionCount: number
}

export const authApi = {
  login: async (data: LoginRequest) => {
    return api.post<LoginResponse>('/auth/login', data)
  },

  logout: async () => {
    return api.post('/auth/logout', {})
  },

  me: async () => {
    return api.get<{ id: string; username: string; role: string; isActive: boolean; tenantId?: string | null; tenantName?: string; tenantSlug?: string; totpEnabled?: boolean }>('/auth/me')
  },

  myPermissions: async () => {
    return api.get<string[]>('/auth/permissions')
  },

  // ── Two-factor authentication ─────────────────────────────────

  setup2fa: async (postAuthToken?: string) => {
    return api.post<TotpSetupResult>(`/auth/2fa/setup`, postAuthToken ? { postAuthToken } : {})
  },

  enroll2fa: async (code: string, postAuthToken?: string) => {
    return api.post<TotpEnrollResult>('/auth/2fa/enroll', postAuthToken ? { postAuthToken, code } : { code })
  },

  verifyLogin2fa: async (postAuthToken: string, code?: string, recoveryCode?: string) => {
    return api.post<LoginResponse>('/auth/2fa/verify-login', { postAuthToken, code, recoveryCode })
  },

  disable2fa: async (code: string) => {
    return api.post('/auth/2fa/disable', { code })
  },

  // ── Admin API ─────────────────────────────────────────────────

  getUsers: async () => {
    return api.get<UserListItem[]>('/auth/users')
  },

  getUserDetail: async (id: string) => {
    return api.get<{ id: string; username: string; role: string; isActive: boolean; overrides: UserOverride[] }>(`/auth/users/${id}`)
  },

  updateUser: async (id: string, data: { role?: string; isActive?: boolean }) => {
    return api.patch(`/auth/users/${id}`, data)
  },

  getAllPermissions: async () => {
    return api.get<PermissionInfo[]>('/auth/permissions/all')
  },

  getRoles: async () => {
    return api.get<RoleInfo[]>('/auth/roles')
  },

  getRolePermissions: async (role: string) => {
    return api.get<string[]>(`/auth/roles/${role}/permissions`)
  },

  setRolePermissions: async (role: string, permissionIds: string[]) => {
    return api.put(`/auth/roles/${role}/permissions`, { permissionIds })
  },

  getUserPermissionOverrides: async (userId: string) => {
    return api.get<UserOverride[]>(`/auth/users/${userId}/permissions`)
  },

  setUserPermissionOverrides: async (userId: string, overrides: { permissionId: string; granted: boolean }[]) => {
    return api.put(`/auth/users/${userId}/permissions`, { overrides })
  },

  deleteUserPermissionOverride: async (userId: string, permissionId: string) => {
    return api.delete(`/auth/users/${userId}/permissions/${permissionId}`)
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    return api.patch('/auth/password', { currentPassword, newPassword })
  }
}
