import { Navigate, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../contexts/AuthContext'
import type { UserRole } from '../../types/database'

export function ProtectedRoute({ requireRole }: { requireRole?: UserRole }) {
  const { user, profile, loading } = useAuth()
  const { t } = useTranslation()

  if (loading) return <p>{t('protectedRoute.loading')}</p>
  if (!user) return <Navigate to="/" replace />
  if (requireRole && profile?.role !== requireRole) return <Navigate to="/" replace />

  return <Outlet />
}
