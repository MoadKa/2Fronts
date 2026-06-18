import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import type { UserRole } from '../../types/database'

export function ProtectedRoute({ requireRole }: { requireRole?: UserRole }) {
  const { user, profile, loading } = useAuth()

  if (loading) return <p>Loading...</p>
  if (!user) return <Navigate to="/" replace />
  if (requireRole && profile?.role !== requireRole) return <Navigate to="/" replace />

  return <Outlet />
}
