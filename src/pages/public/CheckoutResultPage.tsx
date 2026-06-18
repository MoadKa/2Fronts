import { useSearchParams, Link } from 'react-router-dom'

export function CheckoutResultPage() {
  const [searchParams] = useSearchParams()
  const status = searchParams.get('status')

  if (status === 'success') {
    return (
      <div>
        <h2>Payment received</h2>
        <p>We'll start fulfilling your automation shortly. Track its status in My Requests.</p>
        <Link to="/">Back to catalog</Link>
      </div>
    )
  }

  return (
    <div>
      <h2>Checkout cancelled</h2>
      <p>No payment was made. You can try again any time.</p>
      <Link to="/">Back to catalog</Link>
    </div>
  )
}
