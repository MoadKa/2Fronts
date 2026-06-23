import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../ui/Toast'

type Mode = 'signIn' | 'signUp'

export function AuthModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { signIn, signUp } = useAuth()
  const { showToast } = useToast()
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
      showToast(mode === 'signUp' ? 'Konto erstellt' : 'Angemeldet')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Etwas ist schiefgelaufen')
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <h2>{mode === 'signIn' ? 'Anmelden' : 'Registrieren'}</h2>
      {mode === 'signUp' && (
        <Input label="Firmenname" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
      )}
      <Input label="E-Mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Input label="Passwort" type="password" value={password} onChange={(e) => setPassword(e.target.value)} error={error} />
      <div className="page-stack">
        <Button onClick={handleSubmit}>{mode === 'signIn' ? 'Anmelden' : 'Registrieren'}</Button>
        <Button variant="secondary" onClick={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}>
          {mode === 'signIn' ? 'Noch kein Konto? Registrieren' : 'Schon ein Konto? Anmelden'}
        </Button>
      </div>
    </Modal>
  )
}
