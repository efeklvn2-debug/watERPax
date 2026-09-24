import { InputHTMLAttributes } from 'react'

export function DateInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      type="date"
      onClick={(e) => (e.target as HTMLInputElement).showPicker()}
    />
  )
}
