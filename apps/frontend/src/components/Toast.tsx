import { useContext } from 'react'
import { NotificationContext } from '../contexts/NotificationContext'

export function Toast() {
  const ctx = useContext(NotificationContext)
  if (!ctx) return null

  const { notifications, removeNotification } = ctx

  if (notifications.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2" role="status" aria-live="polite" aria-atomic="true">
      {notifications.map(n => (
        <div
          key={n.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg text-white text-sm max-w-sm ${
            n.type === 'success' ? 'bg-green-600' : 'bg-red-600'
          }`}
        >
          <span className="flex-1">{n.message}</span>
          <button
            onClick={() => removeNotification(n.id)}
            className="text-white/80 hover:text-white text-lg leading-none font-bold"
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  )
}
