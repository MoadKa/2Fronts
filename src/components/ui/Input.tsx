import type { InputHTMLAttributes } from 'react'
import { useId } from 'react'
import './Input.css'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
}

export function Input({ label, error, id, ...rest }: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  return (
    <div className="input-field">
      <label htmlFor={inputId}>{label}</label>
      <input id={inputId} {...rest} />
      {error && <span className="input-error">{error}</span>}
    </div>
  )
}
