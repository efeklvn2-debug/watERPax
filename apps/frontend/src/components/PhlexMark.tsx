export function WaterDropMark({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M20 4 C20 4 8 18 8 25 C8 31.627 13.373 36 20 36 C26.627 36 32 31.627 32 25 C32 18 20 4 20 4Z"
        stroke="currentColor"
        strokeWidth="2.2"
        fill="none"
        opacity="0.9"
      />
      <path
        d="M16 26 C16 22 20 14 20 14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.5"
      />
      <circle cx="20" cy="27" r="3" fill="currentColor" opacity="0.7" />
    </svg>
  )
}

/** @deprecated Use WaterDropMark */
export const PhlexMark = WaterDropMark
