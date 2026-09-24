import { useCachedFetch } from './useCachedFetch'
import { settingsApi } from '../api/settings'

export function useBooksLocked() {
  const { data, loading } = useCachedFetch<string | undefined>(
    'settings:booksLockedUntil',
    async () => {
      const res = await settingsApi.getSettings()
      const value: any = res?.data
      return value?.booksLockedUntil as string | undefined
    }
  )
  return { booksLockedUntil: data ?? undefined, loading }
}

export function isDateLocked(date: string, lockDate?: string | null): boolean {
  if (!lockDate || !date) return false
  return date < lockDate
}
