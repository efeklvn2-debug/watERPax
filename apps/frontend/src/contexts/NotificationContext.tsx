import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo, type ReactNode } from 'react'

type NotificationType = 'success' | 'error'

interface Notification {
  id: string
  type: NotificationType
  message: string
}

interface NotificationContextValue {
  notifications: Notification[]
  addNotification: (type: NotificationType, message: string) => void
  removeNotification: (id: string) => void
}

export const NotificationContext = createContext<NotificationContextValue | null>(null)

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  const addNotification = useCallback((type: NotificationType, message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setNotifications(prev => {
      const next = [...prev, { id, type, message }]
      return next.length > 3 ? next.slice(-3) : next
    })
    const timer = setTimeout(() => {
      removeNotification(id)
    }, type === 'error' ? 6000 : 4000)
    timersRef.current.set(id, timer)
  }, [removeNotification])

  useEffect(() => {
    return () => {
      timersRef.current.forEach(timer => clearTimeout(timer))
      timersRef.current.clear()
    }
  }, [])

  return (
    <NotificationContext.Provider value={{ notifications, addNotification, removeNotification }}>
      {children}
    </NotificationContext.Provider>
  )
}

export function useNotification() {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error('useNotification must be used within NotificationProvider')
  return useMemo(() => ({
    success: (message: string) => ctx.addNotification('success', message),
    error: (message: string) => ctx.addNotification('error', message),
  }), [ctx])
}
