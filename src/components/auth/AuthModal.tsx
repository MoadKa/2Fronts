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
      showToast(mode === 'signUp' ? 'Account created' : 'Signed in')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <h2>{mode === 'signIn' ? 'Log in' : 'Sign up'}</h2>
      {mode === 'signUp' && (
        <Input label="Company name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
      )}
      <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} error={error} />
      <Button onClick={handleSubmit}>{mode === 'signIn' ? 'Log in' : 'Sign up'}</Button>
      <Button variant="secondary" onClick={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}>
        {mode === 'signIn' ? 'Need an account? Sign up' : 'Already have an account? Log in'}
      </Button>
    </Modal>
  )
}
