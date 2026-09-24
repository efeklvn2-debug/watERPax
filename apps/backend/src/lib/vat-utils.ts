import { Prisma } from '@prisma/client'

export interface InclusiveBreakdown {
  exclusive: number
  vat: number
}

/**
 * Decompose a VAT-inclusive amount into exclusive + VAT.
 * Formula: exclusive = inclusive / (1 + vatRate/100)
 *          vat = inclusive - exclusive
 */
export function decomposeInclusive(inclusive: number, vatRate: number): InclusiveBreakdown {
  const factor = 1 + vatRate / 100
  const exclusive = inclusive / factor
  const vat = inclusive - exclusive
  return { exclusive, vat }
}
