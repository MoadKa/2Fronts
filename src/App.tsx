import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ToastProvider } from './components/ui/Toast'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { AuthProvider } from './contexts/AuthContext'
import { AppLayout } from './components/layout/AppLayout'
import { NotFoundPage } from './pages/public/NotFoundPage'
import { CatalogPage } from './pages/public/CatalogPage'
import { AutomationDetailPage } from './pages/public/AutomationDetailPage'
import { CheckoutResultPage } from './pages/public/CheckoutResultPage'

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
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  )
}
