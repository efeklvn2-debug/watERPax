export function dateFromInput(dateStr?: string): Date {
  if (!dateStr) return new Date()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return new Date()
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return new Date()
  const now = new Date()
  return new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds())
}

export function dateStartOfDay(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d, 0, 0, 0, 0)
}

export function dateEndOfDay(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d, 23, 59, 59, 999)
}
