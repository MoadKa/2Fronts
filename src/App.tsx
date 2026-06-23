import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ToastProvider } from './components/ui/Toast'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { AuthProvider } from './contexts/AuthContext'
import { AppLayout } from './components/layout/AppLayout'
import { NotFoundPage } from './pages/public/NotFoundPage'
import { CatalogPage } from './pages/public/CatalogPage'
import { AutomationDetailPage } from './pages/public/AutomationDetailPage'
import { SupportedSoftwarePage } from './pages/public/SupportedSoftwarePage'
import { CheckoutResultPage } from './pages/public/CheckoutResultPage'
import { MarketplaceTestPage } from './pages/public/MarketplaceTestPage'
import { ProtectedRoute } from './components/auth/ProtectedRoute'
import { MyRequestsPage } from './pages/customer/MyRequestsPage'
import { MappingConfirmationPage } from './pages/customer/MappingConfirmationPage'
import { AdminCatalogPage } from './pages/admin/AdminCatalogPage'
import { AdminRequestsPage } from './pages/admin/AdminRequestsPage'
import { WaitlistLandingPage } from './pages/public/WaitlistLandingPage'
import { AppHomePage } from './pages/public/AppHomePage'
import { ImpressumPage } from './pages/public/legal/ImpressumPage'
import { DatenschutzPage } from './pages/public/legal/DatenschutzPage'
import { AGBPage } from './pages/public/legal/AGBPage'

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="/" element={<WaitlistLandingPage />} />
                <Route path="/app" element={<AppHomePage />} />
                <Route path="/automations" element={<CatalogPage />} />
                <Route path="/automations/:id" element={<AutomationDetailPage />} />
                <Route path="/impressum" element={<ImpressumPage />} />
                <Route path="/datenschutz" element={<DatenschutzPage />} />
                <Route path="/agb" element={<AGBPage />} />
                <Route path="/supported-software" element={<SupportedSoftwarePage />} />
                <Route path="/checkout/result" element={<CheckoutResultPage />} />
                <Route path="/marketplace-test" element={<MarketplaceTestPage />} />
                <Route element={<ProtectedRoute />}>
                  <Route path="/my-requests" element={<MyRequestsPage />} />
                  <Route path="/connect/:provisionId/confirm" element={<MappingConfirmationPage />} />
                </Route>
                <Route element={<ProtectedRoute requireRole="admin" />}>
                  <Route path="/admin/automations" element={<AdminCatalogPage />} />
                  <Route path="/admin/requests" element={<AdminRequestsPage />} />
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
