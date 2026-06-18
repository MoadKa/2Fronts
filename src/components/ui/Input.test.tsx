import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Input } from './Input'

describe('Input', () => {
  it('renders a label tied to the input and forwards changes', () => {
    const onChange = vi.fn()
    render(<Input label="Email" value="" onChange={onChange} />)
    const input = screen.getByLabelText('Email')
    fireEvent.change(input, { target: { value: 'a@b.com' } })
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('shows an error message when provided', () => {
    render(<Input label="Email" value="" onChange={() => {}} error="Required" />)
    expect(screen.getByText('Required')).toBeInTheDocument()
  })
})
