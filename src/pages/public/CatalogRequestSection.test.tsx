import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import i18n from '../../i18n'
import { industryLabel } from '../../lib/industries'
import { CatalogRequestSection } from './CatalogRequestSection'

const submitWish = vi.fn()
vi.mock('../../services/WishService', () => ({
  submitWish: (...a: unknown[]) => submitWish(...a),
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
    submitWish.mockReset()
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
    submitWish.mockResolvedValue({ ok: true })
    renderSection()
    const T = i18n.getFixedT('de')
    fireEvent.change(screen.getByLabelText(T('catalogRequest.emailLabel')), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText(T('catalogRequest.messageLabel')), { target: { value: 'HubSpot-Sync' } })
    fireEvent.click(screen.getByLabelText(T('catalogRequest.consentLabel')))
    fireEvent.click(screen.getByRole('button', { name: T('catalogRequest.submit') }))

    await waitFor(() =>
      expect(submitWish).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'a@b.com',
          message: 'HubSpot-Sync',
          marketingConsent: true,
        }),
      ),
    )
    await waitFor(() => expect(screen.getByText(T('catalogRequest.success'))).toBeInTheDocument())
  })

  it('passes the selected industry to submitWish', async () => {
    submitWish.mockResolvedValue({ ok: true })
    renderSection()
    const T = i18n.getFixedT('de')
    fireEvent.change(screen.getByLabelText(T('catalogRequest.emailLabel')), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText(T('catalogRequest.industryLabel')), {
      target: { value: 'coaching' },
    })
    fireEvent.click(screen.getByLabelText(T('catalogRequest.consentLabel')))
    fireEvent.click(screen.getByRole('button', { name: T('catalogRequest.submit') }))

    // Sanity: the option label renders via industryLabel.
    expect(screen.getByText(industryLabel('coaching', 'de'))).toBeInTheDocument()
    await waitFor(() =>
      expect(submitWish).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'a@b.com', industry: 'coaching', marketingConsent: true }),
      ),
    )
  })

  it('does not submit without consent (button stays disabled, service never called)', () => {
    renderSection()
    const T = i18n.getFixedT('de')
    fireEvent.change(screen.getByLabelText(T('catalogRequest.emailLabel')), { target: { value: 'a@b.com' } })
    expect(screen.getByRole('button', { name: T('catalogRequest.submit') })).toBeDisabled()
    expect(submitWish).not.toHaveBeenCalled()
  })
})
