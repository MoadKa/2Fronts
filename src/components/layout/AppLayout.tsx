import { Outlet, Link } from 'react-router-dom'
import './AppLayout.css'

export function AppLayout() {
  return (
    <div>
      <nav className="app-nav">
        <Link to="/"><strong>2Fronts</strong></Link>
        <div className="app-nav-links" id="app-nav-links" />
      </nav>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
