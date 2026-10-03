import type { CSSProperties } from 'react'
import { WaterDropMark } from './PhlexMark'

const SIZES = {
  sm: '1rem',
  md: '1.125rem',
  lg: '1.875rem',
  xl: '3rem'
} as const

export type BrandSize = keyof typeof SIZES

// "Waterpax" — cyan Wat, silver erp (the shared "p" closes the silver segment), cyan ax
export function BrandWordmark({
  className = '',
  size
}: {
  className?: string
  size?: BrandSize
}) {
  return (
    <span
      className={`leading-none tracking-tight whitespace-nowrap ${className}`}
      style={{
        fontFamily: "'Montserrat', 'Segoe UI', system-ui, sans-serif",
        fontWeight: 900,
        fontSize: size ? SIZES[size] : undefined
      }}
    >
      <span style={{ color: '#2AB4F5' }}>Wat</span>
      <span style={{ color: '#C8C8C8', textShadow: '0 0 14px rgba(200,200,200,0.4)' }}>erp</span>
      <span style={{ color: '#2AB4F5' }}>ax</span>
    </span>
  )
}

/** Horizontal lockup: droplet left, wordmark on the same baseline,
 *  droplet height matched to the text cap-height. */
export function BrandLockup({
  className = '',
  size = 'md',
  style
}: {
  className?: string
  size?: BrandSize
  style?: CSSProperties
}) {
  return (
    <span
      className={`inline-flex items-baseline ${className}`}
      style={{ fontSize: SIZES[size], ...style }}
    >
      <WaterDropMark className="h-[1.56em] w-auto mr-[0.3em] translate-y-[0.05em]" />
      <BrandWordmark />
    </span>
  )
}
