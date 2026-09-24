/** Shared brand wordmark: Wat + italic ERPax */
export function BrandWordmark({
  className = '',
  size = 'md'
}: {
  className?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  const sizes = {
    sm: 'text-base',
    md: 'text-lg',
    lg: 'text-3xl',
    xl: 'text-5xl'
  }
  return (
    <span className={`font-extrabold tracking-tight leading-none ${sizes[size]} ${className}`}>
      <span className="not-italic">Wat</span>
      <span className="italic font-bold tracking-normal opacity-95">ERPax</span>
    </span>
  )
}
