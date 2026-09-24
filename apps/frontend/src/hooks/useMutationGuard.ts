import { useRef, useCallback } from 'react'

export function useMutationGuard() {
  const guardRef = useRef(false)

  const run = useCallback(async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (guardRef.current) return undefined
    guardRef.current = true
    try {
      return await fn()
    } finally {
      guardRef.current = false
    }
  }, [])

  return { run }
}
