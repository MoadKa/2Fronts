import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './Button.css'

/* `primary` is the lamp — the one lit control in a view. `ink` is a form's own
   solid submit, for the surfaces where a second lamp would be the second one.
   `secondary` is the outline every other action wears. */
type Variant = 'primary' | 'secondary' | 'ink' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  children: ReactNode
}

export function Button({ variant = 'primary', className, children, ...rest }: ButtonProps) {
  const classes = ['btn', `btn-${variant}`, className].filter(Boolean).join(' ')
  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  )
}
