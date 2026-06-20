import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'

export function NotFoundPage() {
  return (
    <div className="empty-state">
      <h2>Page not found.</h2>
      <p>The page you're looking for doesn't exist or has moved.</p>
      <Link to="/"><Button variant="secondary">Back to catalog</Button></Link>
    </div>
  )
}
