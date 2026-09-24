export function dateInputLocal(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().split('T')[0]
}

export function todayLocal(): string {
  return dateInputLocal(new Date())
}
