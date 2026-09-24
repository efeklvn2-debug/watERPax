import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'

const API_BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) || '/api'

const CSRF_COOKIE_NAME = 'waterpax_csrf'
const CSRF_HEADER_NAME = 'X-WaterPax-CSRF'

export interface ApiResponse<T> {
  data?: T
  error?: {
    code: string
    message: string
    details?: unknown
    postAuthToken?: string
  }
}

function getCsrfTokenFromCookie(): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + CSRF_COOKIE_NAME + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

const client = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json'
  }
})

client.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const method = (config.method || 'get').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const csrf = getCsrfTokenFromCookie()
      if (csrf && config.headers) {
        config.headers[CSRF_HEADER_NAME] = csrf
      }
    }
    if (config.method === 'get') {
      config.params = { ...config.params, _t: Date.now() }
    }
    return config
  },
  (error) => Promise.reject(error)
)

let refreshInFlight: Promise<'ok' | 'invalid' | 'transient'> | null = null

function attemptRefresh(): Promise<'ok' | 'invalid' | 'transient'> {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = axios
    .post(`${API_BASE_URL}/auth/refresh`, {}, { withCredentials: true })
    .then(() => 'ok' as const)
    .catch((err: AxiosError) => {
      const status = err.response?.status
      if (status === 401 || status === 403) return 'invalid' as const
      return 'transient' as const
    })
    .finally(() => {
      refreshInFlight = null
    })
  return refreshInFlight
}

client.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }

    const isAuthPath = originalRequest.url?.includes('/auth/login') || originalRequest.url?.includes('/auth/2fa/')

    if (error.response?.status === 401 && !originalRequest._retry && !isAuthPath) {
      originalRequest._retry = true

      const result = await attemptRefresh()
      if (result === 'ok') {
        return client(originalRequest)
      }
      if (result === 'invalid') {
        localStorage.removeItem('auth-storage')
        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
          window.location.href = '/login'
        }
      }
    }

    return Promise.reject(error)
  }
)

export const api = {
  async get<T>(url: string): Promise<ApiResponse<T>> {
    try {
      const response = await client.get<T>(url)
      return { data: response.data }
    } catch (error) {
      return handleError(error)
    }
  },

  async post<T>(url: string, data?: unknown): Promise<ApiResponse<T>> {
    try {
      const response = await client.post<T>(url, data)
      return { data: response.data }
    } catch (error) {
      return handleError(error)
    }
  },

  async put<T>(url: string, data?: unknown): Promise<ApiResponse<T>> {
    try {
      const response = await client.put<T>(url, data)
      return { data: response.data }
    } catch (error) {
      return handleError(error)
    }
  },

  async patch<T>(url: string, data?: unknown): Promise<ApiResponse<T>> {
    try {
      const response = await client.patch<T>(url, data)
      return { data: response.data }
    } catch (error) {
      return handleError(error)
    }
  },

  async delete<T>(url: string): Promise<ApiResponse<T>> {
    try {
      const response = await client.delete<T>(url)
      return { data: response.data ?? null as T }
    } catch (error) {
      return handleError(error)
    }
  }
}

function handleError(error: unknown): ApiResponse<never> {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as any
    if (data?.error) {
      return {
        error: {
          code: data.error.code || 'ERROR',
          message: data.error.message || String(data.error),
          postAuthToken: data.postAuthToken
        }
      }
    }
    return {
      error: {
        code: 'NETWORK_ERROR',
        message: error.message
      }
    }
  }
  return {
    error: {
      code: 'UNKNOWN_ERROR',
      message: 'An unexpected error occurred'
    }
  }
}
