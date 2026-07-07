import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics, type BeforeSendEvent } from '@vercel/analytics/react'
import App from './App.tsx'
import './i18n'
import './index.css'

// GDPR: strip customer identifiers (/connect/:provisionId, /c/:slug) from
// tracked URLs before they leave the browser.
function anonymizePath(event: BeforeSendEvent): BeforeSendEvent {
  const url = new URL(event.url)
  if (url.pathname.startsWith('/connect/')) url.pathname = '/connect/[id]'
  else if (url.pathname.startsWith('/c/')) url.pathname = '/c/[coach]'
  return { ...event, url: url.toString() }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {import.meta.env.PROD && <Analytics beforeSend={anonymizePath} />}
  </StrictMode>
)
