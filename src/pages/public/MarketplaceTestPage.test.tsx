import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MarketplaceTestPage } from './MarketplaceTestPage'
import { submitMarketplaceCapture } from '../../services/MarketplaceCaptureService'
import { ToastProvider } from '../../components/ui/Toast'

vi.mock('../../services/MarketplaceCaptureService', () => ({ submitMarketplaceCapture: vi.fn() }))

function renderPage() {
  return render(
    <ToastProvider>
      <MarketplaceTestPage />
    </ToastProvider>
  )
}

beforeEach(() => {
  vi.mocked(submitMarketplaceCapture).mockReset()
  vi.mocked(submitMarketplaceCapture).mockResolvedValue(undefined)
})

describe('MarketplaceTestPage', () => {
  it('renders all three listings with the missed-call automation marked Featured/Live', () => {
    renderPage()
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3)
  })

  it('adds a noindex meta tag on mount', () => {
    renderPage()
    const meta = document.querySelector('meta[name="robots"]')
    expect(meta).not.toBeNull()
    expect(meta?.getAttribute('content')).toBe('noindex')
  })

  // Regression: live QA found visitors who land on the form without clicking
  // a listing's "Interested?" CTA see an unexplained empty field with no
  // guidance on what to type. Found by /qa on 2026-06-21.
  it('shows placeholder guidance on the automation-of-interest field for visitors who land directly on the form', () => {
    renderPage()
    expect(screen.getByLabelText('Gewünschte Automatisierung')).toHaveAttribute(
      'placeholder',
      expect.stringContaining('Interessiert?')
    )
  })

  it('pre-fills the automation of interest when a listing\'s "Interested? Tell us" link is clicked', () => {
    renderPage()
    fireEvent.click(screen.getAllByText('Interessiert? Sag es uns')[0])
    expect(screen.getByLabelText('Gewünschte Automatisierung')).toHaveValue('AI Missed-Call Recovery')
  })

  it('blocks submit with an inline error when required fields are empty', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /anfragen/i }))
    expect(await screen.findByText('E-Mail ist erforderlich')).toBeInTheDocument()
    expect(submitMarketplaceCapture).not.toHaveBeenCalled()
  })

  it('submits the form and shows a success toast on valid input', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Firmenname'), { target: { value: 'Acme Plumbing' } })
    fireEvent.click(screen.getByRole('button', { name: /anfragen/i }))

    await waitFor(() => expect(submitMarketplaceCapture).toHaveBeenCalledWith({
      email: 'a@b.com',
      businessName: 'Acme Plumbing',
      automationOfInterest: '',
    }))
    expect(await screen.findByText('Danke — wir melden uns')).toBeInTheDocument()
  })

  it('shows an error toast and re-enables the button when the submission fails', async () => {
    vi.mocked(submitMarketplaceCapture).mockRejectedValueOnce(new Error('network error'))
    renderPage()
    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Firmenname'), { target: { value: 'Acme Plumbing' } })
    const button = screen.getByRole('button', { name: /anfragen/i })
    fireEvent.click(button)

    expect(await screen.findByText('Konnte nicht gesendet werden — bitte erneut versuchen')).toBeInTheDocument()
    expect(button).not.toBeDisabled()
  })

  it('disables the submit button while the request is in flight (double-submit protection)', async () => {
    let resolveSubmit: () => void = () => {}
    vi.mocked(submitMarketplaceCapture).mockReturnValueOnce(new Promise((resolve) => { resolveSubmit = () => resolve(undefined) }))
    renderPage()
    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Firmenname'), { target: { value: 'Acme Plumbing' } })
    const button = screen.getByRole('button', { name: /anfragen/i })
    fireEvent.click(button)

    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(submitMarketplaceCapture).toHaveBeenCalledTimes(1)

    resolveSubmit()
    await waitFor(() => expect(button).not.toBeDisabled())
  })
})
