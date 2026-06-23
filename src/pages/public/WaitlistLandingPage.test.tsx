import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { WaitlistLandingPage } from './WaitlistLandingPage'
import { submitWaitlistSignup } from '../../services/WaitlistService'

vi.mock('../../services/WaitlistService', () => ({ submitWaitlistSignup: vi.fn() }))

function renderPage() {
  return render(
    <MemoryRouter>
      <WaitlistLandingPage />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.mocked(submitWaitlistSignup).mockReset()
  vi.mocked(submitWaitlistSignup).mockResolvedValue({ alreadySubscribed: false })
})

describe('WaitlistLandingPage', () => {
  it('renders the hero and the email capture form', () => {
    renderPage()
    expect(screen.getByLabelText('Geschäftliche E-Mail')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Warteliste/i })).toBeInTheDocument()
  })

  it('links to the privacy policy', () => {
    renderPage()
    const link = screen.getByRole('link', { name: /Datenschutzerklärung/i })
    expect(link).toHaveAttribute('href', '/datenschutz')
  })

  it('blocks submit and shows an inline error when the email is empty', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Warteliste/i }))
    expect(screen.getByText('Bitte gib deine E-Mail ein')).toBeInTheDocument()
    expect(submitWaitlistSignup).not.toHaveBeenCalled()
  })

  it('shows an invalid-email error for a malformed address', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Geschäftliche E-Mail'), { target: { value: 'notanemail' } })
    fireEvent.click(screen.getByRole('button', { name: /Warteliste/i }))
    expect(screen.getByText('Bitte gib eine gültige E-Mail-Adresse ein')).toBeInTheDocument()
    expect(submitWaitlistSignup).not.toHaveBeenCalled()
  })

  it('submits a valid email and shows the success state', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Geschäftliche E-Mail'), { target: { value: 'a@b.com' } })
    fireEvent.click(screen.getByRole('button', { name: /Warteliste/i }))

    await waitFor(() =>
      expect(submitWaitlistSignup).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'a@b.com', source: 'landing' })
      )
    )
    expect(await screen.findByText('Du stehst auf der Liste — wir melden uns.')).toBeInTheDocument()
    // form replaced by success message
    expect(screen.queryByRole('button', { name: /Warteliste/i })).not.toBeInTheDocument()
  })

  it('shows the friendly already-subscribed state for a duplicate email', async () => {
    vi.mocked(submitWaitlistSignup).mockResolvedValueOnce({ alreadySubscribed: true })
    renderPage()
    fireEvent.change(screen.getByLabelText('Geschäftliche E-Mail'), { target: { value: 'dup@b.com' } })
    fireEvent.click(screen.getByRole('button', { name: /Warteliste/i }))

    expect(await screen.findByText('Du stehst bereits auf der Liste — danke!')).toBeInTheDocument()
  })

  it('shows an error state when the submission fails', async () => {
    vi.mocked(submitWaitlistSignup).mockRejectedValueOnce(new Error('network'))
    renderPage()
    fireEvent.change(screen.getByLabelText('Geschäftliche E-Mail'), { target: { value: 'a@b.com' } })
    fireEvent.click(screen.getByRole('button', { name: /Warteliste/i }))

    expect(await screen.findByText('Etwas ist schiefgelaufen — bitte erneut versuchen.')).toBeInTheDocument()
    // form is still present so the user can retry
    expect(screen.getByRole('button', { name: /Warteliste/i })).toBeInTheDocument()
  })

  it('disables the submit button while the request is in flight', async () => {
    let resolve: (v: { alreadySubscribed: boolean }) => void = () => {}
    vi.mocked(submitWaitlistSignup).mockReturnValueOnce(new Promise((r) => { resolve = r }))
    renderPage()
    fireEvent.change(screen.getByLabelText('Geschäftliche E-Mail'), { target: { value: 'a@b.com' } })
    const button = screen.getByRole('button', { name: /Warteliste/i })
    fireEvent.click(button)

    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(submitWaitlistSignup).toHaveBeenCalledTimes(1)

    resolve({ alreadySubscribed: false })
    await waitFor(() => expect(screen.queryByText('Du stehst auf der Liste — wir melden uns.')).toBeInTheDocument())
  })
})
