import { useSearchParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { useDocumentMeta } from '../../hooks/useDocumentMeta'

export function CheckoutResultPage() {
  const [searchParams] = useSearchParams()
  const { t } = useTranslation()
  const status = searchParams.get('status')
  // Trial checkouts (create-checkout-session appends trial=1) charged nothing
  // yet, so "Zahlung erhalten" would be wrong — show trial-specific copy.
  const isTrial = searchParams.get('trial') === '1'
  useDocumentMeta({ title: '2Fronts', noindex: true })

  if (status === 'success') {
    return (
      <div className="empty-state">
        <Card>
          <h2>{t(isTrial ? 'checkoutResult.trialTitle' : 'checkoutResult.successTitle')}</h2>
          <p>{t(isTrial ? 'checkoutResult.trialBody' : 'checkoutResult.successBody')}</p>
          <Link to="/my-requests"><Button>{t('checkoutResult.setUpNow')}</Button></Link>
          <Link to="/automations"><Button variant="secondary">{t('checkoutResult.backToCatalog')}</Button></Link>
        </Card>
      </div>
    )
  }

  return (
    <div className="empty-state">
      <Card>
        <h2>{t('checkoutResult.cancelledTitle')}</h2>
        <p>{t('checkoutResult.cancelledBody')}</p>
        <Link to="/automations"><Button variant="secondary">{t('checkoutResult.backToCatalog')}</Button></Link>
      </Card>
    </div>
  )
}
