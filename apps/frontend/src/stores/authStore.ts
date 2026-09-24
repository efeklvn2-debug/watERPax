import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { authApi } from '../api/auth'

interface User {
  id: string
  username: string
  role: 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'VIEWER' | 'SUPER_ADMIN'
  isActive: boolean
  tenantId?: string | null
  tenantName?: string
  tenantSlug?: string
  totpEnabled?: boolean
}

export interface LoginOutcome {
  ok: boolean
  code?: string
  postAuthToken?: string
}

interface AuthState {
  user: User | null
  permissions: string[]
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  login: (username: string, password: string) => Promise<LoginOutcome>
  completeLogin: () => Promise<boolean>
  logout: () => Promise<void>
  checkAuth: () => Promise<void>
  clearError: () => void
}

export function hasPermission(perm: string): boolean {
  const state = useAuthStore.getState()
  return state.permissions.includes(perm)
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      permissions: [],
      isAuthenticated: false,
      isLoading: true,
      error: null,

      login: async (username: string, password: string): Promise<LoginOutcome> => {
        set({ isLoading: true, error: null })
        try {
          const response = await authApi.login({ username, password })

          if (response.error) {
            set({ error: response.error.message, isLoading: false })
            return {
              ok: false,
              code: response.error.code,
              postAuthToken: response.error.postAuthToken
            }
          }

          if (response.data) {
            await useAuthStore.getState().completeLogin()
            return { ok: true }
          } else {
            set({ error: 'Login failed - no response', isLoading: false })
            return { ok: false }
          }
        } catch (error) {
          set({ error: 'Login failed', isLoading: false })
          return { ok: false }
        }
      },

      completeLogin: async (): Promise<boolean> => {
        try {
          const response = await authApi.me()
          if (!response.data) {
            set({ error: 'Authentication failed', isLoading: false })
            return false
          }
          const userData = (response.data as any).data
          const permRes = await authApi.myPermissions()
          set({
            user: userData,
            permissions: (permRes.data as any)?.data ?? [],
            isAuthenticated: true,
            isLoading: false,
            error: null
          })
          return true
        } catch (err) {
          set({ error: 'Authentication failed', isLoading: false })
          return false
        }
      },

      logout: async () => {
        try {
          await authApi.logout()
        } catch {
          // Ignore logout errors
        }
        set({ user: null, permissions: [], isAuthenticated: false, error: null })
      },

      checkAuth: async () => {
        set({ isLoading: true })
        try {
          const response = await authApi.me()

          if (response.data) {
            const userData = (response.data as any).data
            const permRes = await authApi.myPermissions()
            set({
              user: userData,
              permissions: (permRes.data as any)?.data ?? [],
              isAuthenticated: true,
              isLoading: false
            })
          } else {
            set({ user: null, permissions: [], isAuthenticated: false, isLoading: false })
          }
        } catch (err) {
          set({ user: null, permissions: [], isAuthenticated: false, isLoading: false })
        }
      },

      clearError: () => set({ error: null })
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user, permissions: state.permissions, isAuthenticated: state.isAuthenticated }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isLoading = false
        }
      }
    }
  )
)
