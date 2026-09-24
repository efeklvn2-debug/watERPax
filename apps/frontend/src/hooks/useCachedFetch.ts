import { useState, useEffect, useRef, useCallback } from 'react'

interface CacheEntry<T> {
  data: T
  expiry: number
}

const cache = new Map<string, CacheEntry<any>>()
const TTL = 30_000

export function useCachedFetch<T>(key: string, fetchFn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const fetchRef = useRef(0)

  const load = useCallback(async () => {
    const cached = cache.get(key)
    if (cached && Date.now() < cached.expiry) {
      setData(cached.data)
      setLoading(false)
      return
    }

    const tick = ++fetchRef.current
    setLoading(true)
    try {
      const result = await fetchFn()
      if (!mountedRef.current || tick !== fetchRef.current) return
      cache.set(key, { data: result, expiry: Date.now() + TTL })
      setData(result)
      setError(null)
    } catch (err: any) {
      if (!mountedRef.current || tick !== fetchRef.current) return
      setError(err.message || 'Failed to load')
    }
    setLoading(false)
  }, [key, ...deps])

  useEffect(() => {
    mountedRef.current = true
    load()
    return () => { mountedRef.current = false }
  }, [load])

  const invalidate = useCallback(() => {
    cache.delete(key)
    load()
  }, [key])

  return { data, loading, error, refetch: invalidate }
}
