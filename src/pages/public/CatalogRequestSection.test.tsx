import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import i18n from '../../i18n'
import { CatalogRequestSection } from './CatalogRequestSection'

const submitWaitlistSignup = vi.fn()
vi.mock('../../services/WaitlistService', () => ({
  submitWaitlistSignup: (...a: unknown[]) => submitWaitlistSignup(...a),
}))

function renderSection() {
  return render(
    <MemoryRouter>
      <CatalogRequestSection />
    </MemoryRouter>,
  )
}

describe('CatalogRequestSection', () => {
  beforeEach(async () => {
    submitWaitlistSignup.mockReset()
    await i18n.changeLanguage('de')
  })

  it('disables submit until the marketing consent is ticked (DSGVO active opt-in)', () => {
    renderSection()
    const T = i18n.getFixedT('de')
    const btn = screen.getByRole('button', { name: T('catalogRequest.submit') })
    expect(btn).toBeDisabled()
    fireEvent.click(screen.getByLabelText(T('catalogRequest.consentLabel')))
    expect(btn).toBeEnabled()
  })

  it('submits email + message + marketing consent and shows success', async () => {
    submitWaitlistSignup.mockResolvedValue({ alreadySubscribed: false })
    renderSection()
    const T = i18n.getFixedT('de')
    fireEvent.change(screen.getByLabelText(T('catalogRequest.emailLabel')), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText(T('catalogRequest.messageLabel')), { target: { value: 'HubSpot-Sync' } })
    fireEvent.click(screen.getByLabelText(T('catalogRequest.consentLabel')))
    fireEvent.click(screen.getByRole('button', { name: T('catalogRequest.submit') }))

    await waitFor(() =>
      expect(submitWaitlistSignup).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'a@b.com',
          source: 'catalog_request',
          message: 'HubSpot-Sync',
          marketingConsent: true,
        }),
      ),
    )
    await waitFor(() => expect(screen.getByText(T('catalogRequest.success'))).toBeInTheDocument())
  })

  it('does not submit without consent (button stays disabled, service never called)', () => {
    renderSection()
    const T = i18n.getFixedT('de')
    fireEvent.change(screen.getByLabelText(T('catalogRequest.emailLabel')), { target: { value: 'a@b.com' } })
    expect(screen.getByRole('button', { name: T('catalogRequest.submit') })).toBeDisabled()
    expect(submitWaitlistSignup).not.toHaveBeenCalled()
  })
})
