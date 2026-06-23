import { useSearchParams, Link } from 'react-router-dom'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'

export function CheckoutResultPage() {
  const [searchParams] = useSearchParams()
  const status = searchParams.get('status')

  if (status === 'success') {
    return (
      <div className="empty-state">
        <Card>
          <h2>Zahlung erhalten</h2>
          <p>Wir richten deine Automatisierung in Kürze ein. Den Status siehst du unter „Meine Anfragen".</p>
          <Link to="/"><Button>Zurück zum Katalog</Button></Link>
        </Card>
      </div>
    )
  }

  return (
    <div className="empty-state">
      <Card>
        <h2>Checkout abgebrochen</h2>
        <p>Es wurde keine Zahlung vorgenommen. Du kannst es jederzeit erneut versuchen.</p>
        <Link to="/"><Button variant="secondary">Zurück zum Katalog</Button></Link>
      </Card>
    </div>
  )
}
