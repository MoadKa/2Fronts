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
          <h2>Payment received</h2>
          <p>We'll start fulfilling your automation shortly. Track its status in My Requests.</p>
          <Link to="/"><Button>Back to catalog</Button></Link>
        </Card>
      </div>
    )
  }

  return (
    <div className="empty-state">
      <Card>
        <h2>Checkout cancelled</h2>
        <p>No payment was made. You can try again any time.</p>
        <Link to="/"><Button variant="secondary">Back to catalog</Button></Link>
      </Card>
    </div>
  )
}
