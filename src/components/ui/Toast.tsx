import { useCallback, useState, type ReactNode } from 'react'
import { ToastContext, type Tone, type ToastItem } from './ToastContext'
import './Toast.css'

// eslint-disable-next-line react-refresh/only-export-components -- re-export keeps the public import path stable for later tasks
export { useToast } from './useToast'

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const showToast = useCallback((message: string, tone: Tone = 'success') => {
    const id = Date.now()
    setToasts((current) => [...current, { id, message, tone }])
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
    }, 4000)
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
