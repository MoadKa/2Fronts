import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '../ui/Modal'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../ui/Toast'
import './AuthModal.css'

type Mode = 'signIn' | 'signUp'

export function AuthModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { signIn, signUp } = useAuth()
  const { showToast } = useToast()
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit() {
    setError('')
    try {
      if (mode === 'signUp') {
        await signUp(email, password, companyName)
      } else {
        await signIn(email, password)
      }
      showToast(mode === 'signUp' ? t('auth.accountCreated') : t('auth.signedIn'))
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.genericError'))
    }
  }

  // Submit on Enter from any field — a sign-in form should never need a mouse.
  function handleFormSubmit(e: FormEvent) {
    e.preventDefault()
    void handleSubmit()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <form className="auth-modal" onSubmit={handleFormSubmit}>
        <header className="auth-modal-head">
          <span className="auth-modal-mark" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 18V7l8 5 8-5v11" />
            </svg>
          </span>
          <h2>{mode === 'signIn' ? t('auth.signIn') : t('auth.register')}</h2>
        </header>

        <div className="auth-modal-fields">
          {mode === 'signUp' && (
            <Input label={t('auth.companyName')} value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          )}
          <Input label={t('auth.email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input label={t('auth.password')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} error={error} />
        </div>

        <div className="page-stack auth-modal-actions">
          <Button type="submit">{mode === 'signIn' ? t('auth.signIn') : t('auth.register')}</Button>
          <Button type="button" variant="secondary" onClick={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}>
            {mode === 'signIn' ? t('auth.noAccountRegister') : t('auth.haveAccountSignIn')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
