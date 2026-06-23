import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '../ui/Modal'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../ui/Toast'

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

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <h2>{mode === 'signIn' ? t('auth.signIn') : t('auth.register')}</h2>
      {mode === 'signUp' && (
        <Input label={t('auth.companyName')} value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
      )}
      <Input label={t('auth.email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Input label={t('auth.password')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} error={error} />
      <div className="page-stack">
        <Button onClick={handleSubmit}>{mode === 'signIn' ? t('auth.signIn') : t('auth.register')}</Button>
        <Button variant="secondary" onClick={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}>
          {mode === 'signIn' ? t('auth.noAccountRegister') : t('auth.haveAccountSignIn')}
        </Button>
      </div>
    </Modal>
  )
}
