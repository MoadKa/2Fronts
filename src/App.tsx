import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ToastProvider } from './components/ui/Toast'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { AuthProvider } from './contexts/AuthContext'
import { AppLayout } from './components/layout/AppLayout'
import { NotFoundPage } from './pages/public/NotFoundPage'
import { CatalogPage } from './pages/public/CatalogPage'
import { AutomationDetailPage } from './pages/public/AutomationDetailPage'
import { CheckoutResultPage } from './pages/public/CheckoutResultPage'
import { ProtectedRoute } from './components/auth/ProtectedRoute'
import { MyRequestsPage } from './pages/customer/MyRequestsPage'
import { AdminCatalogPage } from './pages/admin/AdminCatalogPage'

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="/" element={<CatalogPage />} />
                <Route path="/automations/:id" element={<AutomationDetailPage />} />
                <Route path="/checkout/result" element={<CheckoutResultPage />} />
                <Route element={<ProtectedRoute />}>
                  <Route path="/my-requests" element={<MyRequestsPage />} />
                </Route>
                <Route element={<ProtectedRoute requireRole="admin" />}>
                  <Route path="/admin/automations" element={<AdminCatalogPage />} />
                </Route>
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  )
}
