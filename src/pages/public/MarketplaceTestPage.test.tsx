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

  it('pre-fills the automation of interest when a listing\'s "Interested? Tell us" link is clicked', () => {
    renderPage()
    fireEvent.click(screen.getAllByText('Interested? Tell us')[0])
    expect(screen.getByLabelText('Automation of interest')).toHaveValue('AI Missed-Call Recovery')
  })

  it('blocks submit with an inline error when required fields are empty', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /request/i }))
    expect(await screen.findByText('Email is required')).toBeInTheDocument()
    expect(submitMarketplaceCapture).not.toHaveBeenCalled()
  })

  it('submits the form and shows a success toast on valid input', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'Acme Plumbing' } })
    fireEvent.click(screen.getByRole('button', { name: /request/i }))

    await waitFor(() => expect(submitMarketplaceCapture).toHaveBeenCalledWith({
      email: 'a@b.com',
      businessName: 'Acme Plumbing',
      automationOfInterest: '',
    }))
    expect(await screen.findByText("Thanks — we'll be in touch")).toBeInTheDocument()
  })

  it('shows an error toast and re-enables the button when the submission fails', async () => {
    vi.mocked(submitMarketplaceCapture).mockRejectedValueOnce(new Error('network error'))
    renderPage()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'Acme Plumbing' } })
    const button = screen.getByRole('button', { name: /request/i })
    fireEvent.click(button)

    expect(await screen.findByText('Could not send — please try again')).toBeInTheDocument()
    expect(button).not.toBeDisabled()
  })

  it('disables the submit button while the request is in flight (double-submit protection)', async () => {
    let resolveSubmit: () => void = () => {}
    vi.mocked(submitMarketplaceCapture).mockReturnValueOnce(new Promise((resolve) => { resolveSubmit = () => resolve(undefined) }))
    renderPage()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'Acme Plumbing' } })
    const button = screen.getByRole('button', { name: /request/i })
    fireEvent.click(button)

    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(submitMarketplaceCapture).toHaveBeenCalledTimes(1)

    resolveSubmit()
    await waitFor(() => expect(button).not.toBeDisabled())
  })
})
