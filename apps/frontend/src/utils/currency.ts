/**
 * Shared money formatter — strict 2 decimal places everywhere.
 * ₦1,234.56
 */
export function formatNaira(amount: number | null | undefined): string {
  const n = Number(amount) || 0
  const sign = n < 0 ? '-' : ''
  return sign + '₦' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
