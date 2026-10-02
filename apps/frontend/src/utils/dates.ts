export function dateInputLocal(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().split('T')[0]
}

export function todayLocal(): string {
  return dateInputLocal(new Date())
}

export function timeAgo(d: string | Date): string {
  const then = new Date(d).getTime()
  const diffMs = Date.now() - then
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}
