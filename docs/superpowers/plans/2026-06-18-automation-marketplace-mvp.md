# Automation Marketplace MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the category-agnostic automation marketplace MVP: customers browse a catalog, request and pay for an automation, and admins manually fulfill it.

**Architecture:** React + Vite + TypeScript SPA backed by Supabase (Postgres + Auth + RLS), with Stripe Checkout for one-time payments and a Supabase Edge Function webhook to confirm payment.

**Tech Stack:** Vite 6, React 18, TypeScript (strict), react-router-dom v6, @supabase/supabase-js v2, @stripe/stripe-js, Stripe Node SDK (via `npm:stripe` in Deno edge functions), Vitest + @testing-library/react, Playwright.

## Global Constraints

- Node 20+, npm as package manager (no yarn/pnpm).
- TypeScript strict mode on for the whole project.
- `category` on `automations` is a plain text column — never an enum, never a hardcoded list in code.
- One-time Stripe Checkout payments only — no subscriptions.
- No builder/seller accounts, no ratings/reviews, no AI generation, no automated install — fulfillment status is set manually by admins.
- Every branch is `feature/<task-slug>` off `main`, opened as a PR, reviewed by an independent code-reviewer agent, then merged — no direct commits to `main`.
- `npm run lint`, `npm run test`, and `npm run build` must all pass with zero errors before any PR is opened — non-negotiable merge gate, not just a suggestion.

## Workflow & Skills

Apply this **End-of-Task procedure** after the last step of every task below (not repeated per task to save space):

1. `superpowers:using-git-worktrees` — each task runs in its own worktree on `feature/<task-slug>`, isolated from other in-flight tasks.
2. `superpowers:test-driven-development` — already encoded in each task's Red/Green/Commit steps; don't skip the "verify it fails" step.
3. Push the branch and open the PR:
   ```bash
   git push -u origin feature/<task-slug>
   gh pr create --title "<task title>" --body "Implements Task N of docs/superpowers/plans/2026-06-18-automation-marketplace-mvp.md"
   ```
4. `superpowers:requesting-code-review` — request review from a **fresh subagent** (general-purpose or `feature-dev:code-reviewer`) that did not write the code, so feedback is unbiased.
5. `superpowers:receiving-code-review` — triage feedback with rigor (verify, don't blindly apply); fix in new commits on the same branch.
6. `superpowers:verification-before-completion` — re-run `npm run lint`, `npm run test`, and `npm run build`; all three must be clean before claiming the task done. Check the Security Checklist below against the diff.
7. `superpowers:finishing-a-development-branch` — merge the PR into `main`, delete the branch, pull `main` in any other active worktree that depends on it.

**Parallelization (`superpowers:dispatching-parallel-agents`):** **Correction (caught during execution):** the original claim that Tasks 3 and 6 could run in parallel was wrong, and re-checking every task's Files list against the others shows the same problem recurs everywhere — Tasks 3, 4, 5, 6, and 7 *all* modify `src/App.tsx` and/or `src/components/layout/AppLayout.tsx` to wire in their routes/nav links, and Task 3/Task 6 additionally both write `AutomationService.ts` (Task 4/Task 7 both write `RequestService.ts`). There is no pair of remaining tasks that is actually file-disjoint. Execute Tasks 1 through 8 strictly sequentially — merge each one into `main` before branching the next task's worktree from it. This trades the theoretical parallel-speedup for correctness; re-evaluate per-task file lists before ever dispatching two tasks in parallel rather than trusting a plan-time claim.

**GitHub remote (one-time, end of Task 1):** the user creates an empty `2Fronts` repo on github.com and provides its URL. Run:
```bash
git remote add origin <the-github-repo-url-the-user-provided>
git push -u origin main
```
All subsequent feature branches push to this same `origin`.

**Merge method (decided during Task 1 execution):** `gh` CLI is installed in this
environment but not authenticated, and authenticating requires an interactive
browser login the agent cannot perform. Tasks are therefore not opened as
GitHub PRs. Each task is still implemented in its own worktree/branch and
independently reviewed by a fresh subagent (spec compliance + code quality,
with a re-review loop on any Important/Critical finding) before it is
fast-forward merged into `main` and pushed — the subagent review is the
approval gate in place of a GitHub PR review. If `gh auth login` is completed
later, subsequent tasks can switch back to real PRs without any change to
the plan itself.

## Documentation Checks

These APIs change between versions — verify against current official docs before writing the code, don't rely on memory:
- Supabase JS client: https://supabase.com/docs/reference/javascript
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Edge Functions (Deno): https://supabase.com/docs/guides/functions
- Stripe Checkout Sessions: https://docs.stripe.com/checkout/quickstart
- Stripe webhook signature verification: https://docs.stripe.com/webhooks
- React Router v6 data APIs: https://reactrouter.com/en/main

## Security Checklist

Check every item against the diff before opening a PR (part of `superpowers:verification-before-completion`, Step 6 above):
- RLS is enabled on every table with default-deny; policies grant the minimum access (customers read/write only their own rows; admins via a `role = 'admin'` check, never a hardcoded user id).
- The Stripe **secret key** and Supabase **service_role key** are only ever used inside edge functions, never imported into `src/` or shipped to the client bundle.
- The Stripe webhook handler verifies the signature (`stripe.webhooks.constructEvent`) before trusting any payload — never updates `automation_requests` from an unverified request.
- The automation **price charged is always read server-side** from the `automations` table inside the edge function that creates the Checkout Session — never trust a price sent from the client.
- `.env`, `.env.local` are git-ignored; only `.env.example` (no real values) is committed.
- All Supabase queries go through the supabase-js query builder (parameterized) — no raw string-concatenated SQL.
- Admin-only pages/routes are enforced both in the UI (`ProtectedRoute`) and in RLS — the UI check is convenience, RLS is the actual security boundary.

---

## Task 1: Project Scaffold, Database Schema, and UI Kit

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `index.html`, `.gitignore`, `.env.example`
- Create: `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/vite-env.d.ts`, `src/test-setup.ts`
- Create: `src/lib/supabaseClient.ts`, `src/lib/supabaseClient.test.ts`
- Create: `src/types/database.ts`
- Create: `src/components/ui/Button.tsx`, `src/components/ui/Button.css`, `src/components/ui/Button.test.tsx`
- Create: `src/components/ui/Input.tsx`, `src/components/ui/Input.css`, `src/components/ui/Input.test.tsx`
- Create: `src/components/ui/Card.tsx`, `src/components/ui/Card.css`
- Create: `src/components/ui/Badge.tsx`, `src/components/ui/Badge.css`
- Create: `src/components/ui/Modal.tsx`, `src/components/ui/Modal.css`, `src/components/ui/Modal.test.tsx`
- Create: `src/components/ui/Toast.tsx`, `src/components/ui/Toast.css`, `src/components/ui/Toast.test.tsx`
- Create: `src/components/ui/ErrorBoundary.tsx`, `src/components/ui/ErrorBoundary.test.tsx`
- Create: `src/components/layout/AppLayout.tsx`, `src/components/layout/AppLayout.css`
- Create: `src/pages/public/NotFoundPage.tsx`
- Create: `supabase/migrations/20260618000000_initial_schema.sql`

**Interfaces:**
- Produces: `supabase` client export from `src/lib/supabaseClient.ts` (`import { supabase } from '../lib/supabaseClient'`).
- Produces: types `UserRole`, `Profile`, `Automation`, `RequestStatus`, `AutomationRequest`, `AutomationRequestWithAutomation` from `src/types/database.ts`.
- Produces: `<Button variant?: 'primary'|'secondary'|'danger' />`, `<Input />` (wraps a labeled text input), `<Card />`, `<Badge tone?: 'neutral'|'success'|'warning'|'danger' />`, `<Modal isOpen, onClose, children />`, `useToast()` hook returning `{ showToast(message: string, tone?: 'success'|'error') }` plus a `<ToastProvider>` wrapping `App`, `<ErrorBoundary>`.
- Produces: `<AppLayout>` rendering a top nav (placeholder nav links wired up in Task 2) and `<Outlet />`.
- Produces: DB tables `profiles`, `automations`, `automation_requests` with RLS enabled (policies finalized incrementally per task as needed, base read/write owner policies added now).

### Steps

- [ ] **Step 1: Scaffold the Vite React-TS project**

Run:
```bash
npm create vite@latest . -- --template react-ts
```
When prompted about the non-empty directory (it contains `docs/`), choose to continue/ignore existing files.

- [ ] **Step 2: Install runtime and dev dependencies**

```bash
npm install react-router-dom @supabase/supabase-js @stripe/stripe-js
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @playwright/test
```

- [ ] **Step 3: Configure Vitest in `vite.config.ts`**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
  },
})
```

Create `src/test-setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'
```

Add to `package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Write the failing test for the Supabase client**

Create `src/lib/supabaseClient.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('supabaseClient', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('throws when VITE_SUPABASE_URL is missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    await expect(import('./supabaseClient')).rejects.toThrow(
      'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables'
    )
  })

  it('creates a client when env vars are present', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    const { supabase } = await import('./supabaseClient')
    expect(supabase.auth).toBeDefined()
  })
})
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx vitest run src/lib/supabaseClient.test.ts`
Expected: FAIL — `src/lib/supabaseClient.ts` does not exist yet.

- [ ] **Step 6: Implement the Supabase client**

Create `src/lib/supabaseClient.ts`:
```ts
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
```

Create `.env.example`:
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_STRIPE_PUBLISHABLE_KEY=
```

- [ ] **Step 7: Run it to verify it passes**

Run: `npx vitest run src/lib/supabaseClient.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: scaffold Vite React-TS project with Supabase client"
```

- [ ] **Step 9: Define shared database types**

Create `src/types/database.ts`:
```ts
export type UserRole = 'customer' | 'admin'

export interface Profile {
  id: string
  role: UserRole
  company_name: string
  email: string
}

export interface Automation {
  id: string
  name: string
  summary: string
  outcome_description: string
  category: string
  price_cents: number
  currency: string
  is_active: boolean
  created_at: string
}

export type RequestStatus =
  | 'requested'
  | 'payment_pending'
  | 'paid'
  | 'in_progress'
  | 'delivered'
  | 'cancelled'

export interface AutomationRequest {
  id: string
  automation_id: string
  customer_id: string
  status: RequestStatus
  stripe_checkout_session_id: string | null
  delivery_notes: string | null
  requested_at: string
  paid_at: string | null
  delivered_at: string | null
}

export interface AutomationRequestWithAutomation extends AutomationRequest {
  automation: Automation
}
```

- [ ] **Step 10: Commit**

```bash
git add src/types/database.ts
git commit -m "feat: add shared database types"
```

- [ ] **Step 11: Write the failing test for Button**

Create `src/components/ui/Button.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from './Button'

describe('Button', () => {
  it('renders children and responds to clicks', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Click me</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Click me' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('applies the requested variant class', () => {
    render(<Button variant="danger">Delete</Button>)
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('btn-danger')
  })
})
```

- [ ] **Step 12: Run it to verify it fails**

Run: `npx vitest run src/components/ui/Button.test.tsx`
Expected: FAIL — `./Button` does not exist.

- [ ] **Step 13: Implement Button**

Create `src/components/ui/Button.css`:
```css
.btn { padding: 0.5rem 1rem; border-radius: 6px; border: 1px solid transparent; font-size: 0.95rem; cursor: pointer; }
.btn-primary { background: #2563eb; color: white; }
.btn-secondary { background: #e5e7eb; color: #111827; }
.btn-danger { background: #dc2626; color: white; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
```

Create `src/components/ui/Button.tsx`:
```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './Button.css'

type Variant = 'primary' | 'secondary' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  children: ReactNode
}

export function Button({ variant = 'primary', className, children, ...rest }: ButtonProps) {
  const classes = ['btn', `btn-${variant}`, className].filter(Boolean).join(' ')
  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  )
}
```

- [ ] **Step 14: Run it to verify it passes**

Run: `npx vitest run src/components/ui/Button.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 15: Commit**

```bash
git add src/components/ui/Button.tsx src/components/ui/Button.css src/components/ui/Button.test.tsx
git commit -m "feat: add Button UI component"
```

- [ ] **Step 16: Write the failing test for Input**

Create `src/components/ui/Input.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Input } from './Input'

describe('Input', () => {
  it('renders a label tied to the input and forwards changes', () => {
    const onChange = vi.fn()
    render(<Input label="Email" value="" onChange={onChange} />)
    const input = screen.getByLabelText('Email')
    fireEvent.change(input, { target: { value: 'a@b.com' } })
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('shows an error message when provided', () => {
    render(<Input label="Email" value="" onChange={() => {}} error="Required" />)
    expect(screen.getByText('Required')).toBeInTheDocument()
  })
})
```

- [ ] **Step 17: Run it to verify it fails**

Run: `npx vitest run src/components/ui/Input.test.tsx`
Expected: FAIL — `./Input` does not exist.

- [ ] **Step 18: Implement Input**

Create `src/components/ui/Input.css`:
```css
.input-field { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.75rem; }
.input-field input { padding: 0.5rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: 0.95rem; }
.input-error { color: #dc2626; font-size: 0.85rem; }
```

Create `src/components/ui/Input.tsx`:
```tsx
import type { InputHTMLAttributes } from 'react'
import { useId } from 'react'
import './Input.css'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
}

export function Input({ label, error, id, ...rest }: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  return (
    <div className="input-field">
      <label htmlFor={inputId}>{label}</label>
      <input id={inputId} {...rest} />
      {error && <span className="input-error">{error}</span>}
    </div>
  )
}
```

- [ ] **Step 19: Run it to verify it passes**

Run: `npx vitest run src/components/ui/Input.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 20: Commit**

```bash
git add src/components/ui/Input.tsx src/components/ui/Input.css src/components/ui/Input.test.tsx
git commit -m "feat: add Input UI component"
```

- [ ] **Step 21: Implement Card and Badge (no test — pure presentational wrappers)**

Create `src/components/ui/Card.css`:
```css
.card { background: white; border: 1px solid #e5e7eb; border-radius: 10px; padding: 1.25rem; }
```

Create `src/components/ui/Card.tsx`:
```tsx
import type { HTMLAttributes } from 'react'
import './Card.css'

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={['card', className].filter(Boolean).join(' ')} {...rest} />
}
```

Create `src/components/ui/Badge.css`:
```css
.badge { display: inline-block; padding: 0.15rem 0.6rem; border-radius: 999px; font-size: 0.8rem; font-weight: 600; }
.badge-neutral { background: #e5e7eb; color: #374151; }
.badge-success { background: #dcfce7; color: #166534; }
.badge-warning { background: #fef9c3; color: #854d0e; }
.badge-danger { background: #fee2e2; color: #991b1b; }
```

Create `src/components/ui/Badge.tsx`:
```tsx
import type { ReactNode } from 'react'
import './Badge.css'

type Tone = 'neutral' | 'success' | 'warning' | 'danger'

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}
```

- [ ] **Step 22: Commit**

```bash
git add src/components/ui/Card.tsx src/components/ui/Card.css src/components/ui/Badge.tsx src/components/ui/Badge.css
git commit -m "feat: add Card and Badge UI components"
```

- [ ] **Step 23: Write the failing test for Modal**

Create `src/components/ui/Modal.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Modal } from './Modal'

describe('Modal', () => {
  it('renders children when open and calls onClose on overlay click', () => {
    const onClose = vi.fn()
    render(
      <Modal isOpen onClose={onClose}>
        <p>Hello inside modal</p>
      </Modal>
    )
    expect(screen.getByText('Hello inside modal')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('modal-overlay'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders nothing when closed', () => {
    render(
      <Modal isOpen={false} onClose={() => {}}>
        <p>Hidden</p>
      </Modal>
    )
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 24: Run it to verify it fails**

Run: `npx vitest run src/components/ui/Modal.test.tsx`
Expected: FAIL — `./Modal` does not exist.

- [ ] **Step 25: Implement Modal**

Create `src/components/ui/Modal.css`:
```css
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; }
.modal-content { background: white; border-radius: 10px; padding: 1.5rem; min-width: 320px; max-width: 90vw; }
```

Create `src/components/ui/Modal.tsx`:
```tsx
import type { ReactNode } from 'react'
import './Modal.css'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  children: ReactNode
}

export function Modal({ isOpen, onClose, children }: ModalProps) {
  if (!isOpen) return null
  return (
    <div className="modal-overlay" data-testid="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 26: Run it to verify it passes**

Run: `npx vitest run src/components/ui/Modal.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 27: Commit**

```bash
git add src/components/ui/Modal.tsx src/components/ui/Modal.css src/components/ui/Modal.test.tsx
git commit -m "feat: add Modal UI component"
```

- [ ] **Step 28: Write the failing test for the Toast system**

Create `src/components/ui/Toast.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToastProvider, useToast } from './Toast'

function Trigger() {
  const { showToast } = useToast()
  return <button onClick={() => showToast('Saved!', 'success')}>Trigger</button>
}

describe('Toast', () => {
  it('shows a toast message when showToast is called', () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }))
    expect(screen.getByText('Saved!')).toBeInTheDocument()
  })
})
```

- [ ] **Step 29: Run it to verify it fails**

Run: `npx vitest run src/components/ui/Toast.test.tsx`
Expected: FAIL — `./Toast` does not exist.

- [ ] **Step 30: Implement the Toast system**

Create `src/components/ui/Toast.css`:
```css
.toast-stack { position: fixed; bottom: 1rem; right: 1rem; display: flex; flex-direction: column; gap: 0.5rem; z-index: 1000; }
.toast { padding: 0.75rem 1rem; border-radius: 8px; color: white; }
.toast-success { background: #16a34a; }
.toast-error { background: #dc2626; }
```

Create `src/components/ui/Toast.tsx`:
```tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import './Toast.css'

type Tone = 'success' | 'error'
interface ToastItem { id: number; message: string; tone: Tone }
interface ToastContextValue { showToast: (message: string, tone?: Tone) => void }

const ToastContext = createContext<ToastContextValue | null>(null)

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
      <div className="toast-stack">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used within a ToastProvider')
  return context
}
```

- [ ] **Step 31: Run it to verify it passes**

Run: `npx vitest run src/components/ui/Toast.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 32: Commit**

```bash
git add src/components/ui/Toast.tsx src/components/ui/Toast.css src/components/ui/Toast.test.tsx
git commit -m "feat: add Toast notification system"
```

- [ ] **Step 33: Write the failing test for ErrorBoundary**

Create `src/components/ui/ErrorBoundary.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'

function Boom(): never {
  throw new Error('boom')
}

describe('ErrorBoundary', () => {
  it('renders a fallback message instead of crashing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 34: Run it to verify it fails**

Run: `npx vitest run src/components/ui/ErrorBoundary.test.tsx`
Expected: FAIL — `./ErrorBoundary` does not exist.

- [ ] **Step 35: Implement ErrorBoundary**

Create `src/components/ui/ErrorBoundary.tsx`:
```tsx
import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { hasError: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return <p>Something went wrong.</p>
    }
    return this.props.children
  }
}
```

- [ ] **Step 36: Run it to verify it passes**

Run: `npx vitest run src/components/ui/ErrorBoundary.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 37: Commit**

```bash
git add src/components/ui/ErrorBoundary.tsx src/components/ui/ErrorBoundary.test.tsx
git commit -m "feat: add ErrorBoundary component"
```

- [ ] **Step 38: Build the app shell (AppLayout, NotFoundPage, App, main)**

Create `src/components/layout/AppLayout.css`:
```css
.app-nav { display: flex; align-items: center; justify-content: space-between; padding: 1rem 2rem; border-bottom: 1px solid #e5e7eb; }
.app-nav-links { display: flex; gap: 1rem; }
.app-main { padding: 2rem; max-width: 960px; margin: 0 auto; }
```

Create `src/components/layout/AppLayout.tsx`:
```tsx
import { Outlet, Link } from 'react-router-dom'
import './AppLayout.css'

export function AppLayout() {
  return (
    <div>
      <nav className="app-nav">
        <Link to="/"><strong>2Fronts</strong></Link>
        <div className="app-nav-links" id="app-nav-links" />
      </nav>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
```

Create `src/pages/public/NotFoundPage.tsx`:
```tsx
export function NotFoundPage() {
  return <p>Page not found.</p>
}
```

Create `src/App.tsx`:
```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ToastProvider } from './components/ui/Toast'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { AppLayout } from './components/layout/AppLayout'
import { NotFoundPage } from './pages/public/NotFoundPage'

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  )
}
```

Replace `src/main.tsx` with:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

- [ ] **Step 39: Verify the app builds and lints clean**

Run: `npm run build && npm run lint`
Expected: both exit with code 0, no errors.

- [ ] **Step 40: Commit**

```bash
git add src/App.tsx src/main.tsx src/components/layout src/pages/public/NotFoundPage.tsx
git commit -m "feat: wire up app shell with routing, toasts, and error boundary"
```

- [ ] **Step 41: Write the initial database migration**

Create `supabase/migrations/20260618000000_initial_schema.sql`:
```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('customer', 'admin')) default 'customer',
  company_name text not null default '',
  email text not null
);

create table automations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  summary text not null,
  outcome_description text not null,
  category text not null,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'eur',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table automation_requests (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references automations(id),
  customer_id uuid not null references profiles(id),
  status text not null check (
    status in ('requested', 'payment_pending', 'paid', 'in_progress', 'delivered', 'cancelled')
  ) default 'requested',
  stripe_checkout_session_id text,
  delivery_notes text,
  requested_at timestamptz not null default now(),
  paid_at timestamptz,
  delivered_at timestamptz
);

alter table profiles enable row level security;
alter table automations enable row level security;
alter table automation_requests enable row level security;

create function is_admin() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable;

create policy "users read own profile" on profiles
  for select using (id = auth.uid() or is_admin());
create policy "users update own profile" on profiles
  for update using (id = auth.uid());
create policy "users insert own profile" on profiles
  for insert with check (id = auth.uid());

create policy "anyone reads active automations" on automations
  for select using (is_active = true or is_admin());
create policy "admins manage automations" on automations
  for insert with check (is_admin());
create policy "admins update automations" on automations
  for update using (is_admin());

create policy "customers read own requests" on automation_requests
  for select using (customer_id = auth.uid() or is_admin());
create policy "customers create own requests" on automation_requests
  for insert with check (customer_id = auth.uid());
create policy "admins update requests" on automation_requests
  for update using (is_admin());
```

- [ ] **Step 42: Apply the migration and verify**

Run: `supabase db push` (requires the Supabase project to already be linked via `supabase link --project-ref <ref>`, using the project the user created when wiring up `.env`).
Expected: output lists the migration as applied with no SQL errors.

- [ ] **Step 43: Commit**

```bash
git add supabase/migrations/20260618000000_initial_schema.sql
git commit -m "feat: add initial database schema with RLS policies"
```

Follow the **End-of-task procedure** from Workflow & Skills now: push `feature/scaffold-and-ui-kit`, open the PR, get it reviewed by a fresh agent, address feedback, verify lint/test/build, merge, and (since this is the first task) also run the **GitHub remote** one-time step above before pushing.

---

## Task 2: Auth & Roles

**Files:**
- Create: `src/contexts/AuthContext.tsx`, `src/contexts/AuthContext.test.tsx`
- Create: `src/components/auth/ProtectedRoute.tsx`, `src/components/auth/ProtectedRoute.test.tsx`
- Create: `src/components/auth/AuthModal.tsx`, `src/components/auth/AuthModal.test.tsx`
- Modify: `src/components/layout/AppLayout.tsx` (add login/logout nav controls)
- Modify: `src/App.tsx` (wrap routes in `AuthProvider`)

**Interfaces:**
- Consumes: `supabase` from `src/lib/supabaseClient.ts`; `Profile`, `UserRole` from `src/types/database.ts`; `Modal`, `Input`, `Button` from Task 1; `useToast` from Task 1.
- Produces: `AuthProvider` and `useAuth(): { user: User | null, profile: Profile | null, loading: boolean, signUp(email, password, companyName): Promise<void>, signIn(email, password): Promise<void>, signOut(): Promise<void> }` — every later task that needs the current user or role uses this hook.
- Produces: `<ProtectedRoute requireRole?: UserRole />` as a route element wrapping nested `<Route>`s — Tasks 5, 6, 7 use this to gate customer/admin pages.

### Steps

- [ ] **Step 1: Write the failing test for AuthContext**

Create `src/contexts/AuthContext.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext'

const mockProfile = { id: 'user-1', role: 'customer', company_name: 'Acme', email: 'a@acme.com' }
const authState: { session: { user: { id: string; email: string } } | null } = { session: null }

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: authState.session } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signUp: vi.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null })),
      signInWithPassword: vi.fn(() => Promise.resolve({ error: null })),
      signOut: vi.fn(() => Promise.resolve()),
    },
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: mockProfile }) }) }),
      insert: vi.fn(() => Promise.resolve({ error: null })),
    })),
  },
}))

function Probe() {
  const { user, loading, signUp } = useAuth()
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user?.id ?? 'none'}</span>
      <button onClick={() => signUp('a@acme.com', 'pw123456', 'Acme')}>Sign up</button>
    </div>
  )
}

describe('AuthContext', () => {
  beforeEach(() => {
    authState.session = null
  })

  it('finishes loading with no user when there is no session', async () => {
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'))
    expect(screen.getByTestId('user').textContent).toBe('none')
  })

  it('signUp creates the auth user and a matching profile row', async () => {
    const { supabase } = await import('../lib/supabaseClient')
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'))
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))
    await waitFor(() =>
      expect(supabase.auth.signUp).toHaveBeenCalledWith({ email: 'a@acme.com', password: 'pw123456' })
    )
    expect(supabase.from).toHaveBeenCalledWith('profiles')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/contexts/AuthContext.test.tsx`
Expected: FAIL — `./AuthContext` does not exist.

- [ ] **Step 3: Implement AuthContext**

Create `src/contexts/AuthContext.tsx`:
```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import type { Profile } from '../types/database'

interface AuthContextValue {
  user: User | null
  profile: Profile | null
  loading: boolean
  signUp: (email: string, password: string, companyName: string) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
  return (data as Profile) ?? null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const sessionUser = data.session?.user ?? null
      setUser(sessionUser as User | null)
      setProfile(sessionUser ? await loadProfile(sessionUser.id) : null)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const sessionUser = session?.user ?? null
      setUser(sessionUser as User | null)
      setProfile(sessionUser ? await loadProfile(sessionUser.id) : null)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  async function signUp(email: string, password: string, companyName: string) {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    if (data.user) {
      await supabase.from('profiles').insert({ id: data.user.id, role: 'customer', company_name: companyName, email })
    }
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/contexts/AuthContext.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/contexts/AuthContext.tsx src/contexts/AuthContext.test.tsx
git commit -m "feat: add AuthContext with Supabase email/password auth"
```

- [ ] **Step 6: Write the failing test for ProtectedRoute**

Create `src/components/auth/ProtectedRoute.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ProtectedRoute } from './ProtectedRoute'
import { useAuth } from '../../contexts/AuthContext'

vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))

function renderProtected() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/" element={<p>Home</p>} />
        <Route element={<ProtectedRoute requireRole="admin" />}>
          <Route path="/admin" element={<p>Admin area</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('ProtectedRoute', () => {
  it('redirects to home when there is no user', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, profile: null, loading: false, signUp: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })
    renderProtected()
    expect(screen.getByText('Home')).toBeInTheDocument()
  })

  it('redirects to home when the role does not match', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'u1' } as never,
      profile: { id: 'u1', role: 'customer', company_name: 'Acme', email: 'a@acme.com' },
      loading: false,
      signUp: vi.fn(), signIn: vi.fn(), signOut: vi.fn(),
    })
    renderProtected()
    expect(screen.getByText('Home')).toBeInTheDocument()
  })

  it('renders the nested route when the role matches', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'u1' } as never,
      profile: { id: 'u1', role: 'admin', company_name: 'Acme', email: 'a@acme.com' },
      loading: false,
      signUp: vi.fn(), signIn: vi.fn(), signOut: vi.fn(),
    })
    renderProtected()
    expect(screen.getByText('Admin area')).toBeInTheDocument()
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run src/components/auth/ProtectedRoute.test.tsx`
Expected: FAIL — `./ProtectedRoute` does not exist.

- [ ] **Step 8: Implement ProtectedRoute**

Create `src/components/auth/ProtectedRoute.tsx`:
```tsx
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import type { UserRole } from '../../types/database'

export function ProtectedRoute({ requireRole }: { requireRole?: UserRole }) {
  const { user, profile, loading } = useAuth()

  if (loading) return <p>Loading...</p>
  if (!user) return <Navigate to="/" replace />
  if (requireRole && profile?.role !== requireRole) return <Navigate to="/" replace />

  return <Outlet />
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `npx vitest run src/components/auth/ProtectedRoute.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 10: Commit**

```bash
git add src/components/auth/ProtectedRoute.tsx src/components/auth/ProtectedRoute.test.tsx
git commit -m "feat: add ProtectedRoute for customer/admin route gating"
```

- [ ] **Step 11: Write the failing test for AuthModal**

Create `src/components/auth/AuthModal.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AuthModal } from './AuthModal'
import { useAuth } from '../../contexts/AuthContext'
import { ToastProvider } from '../ui/Toast'

vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))

describe('AuthModal', () => {
  it('calls signIn with the entered credentials', async () => {
    const signIn = vi.fn(() => Promise.resolve())
    vi.mocked(useAuth).mockReturnValue({ user: null, profile: null, loading: false, signUp: vi.fn(), signIn, signOut: vi.fn() })
    render(<ToastProvider><AuthModal isOpen onClose={() => {}} /></ToastProvider>)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('a@b.com', 'secret123'))
  })

  it('shows an error message when sign in fails', async () => {
    const signIn = vi.fn(() => Promise.reject(new Error('Invalid credentials')))
    vi.mocked(useAuth).mockReturnValue({ user: null, profile: null, loading: false, signUp: vi.fn(), signIn, signOut: vi.fn() })
    render(<ToastProvider><AuthModal isOpen onClose={() => {}} /></ToastProvider>)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
    await waitFor(() => expect(screen.getByText('Invalid credentials')).toBeInTheDocument())
  })
})
```

- [ ] **Step 12: Run it to verify it fails**

Run: `npx vitest run src/components/auth/AuthModal.test.tsx`
Expected: FAIL — `./AuthModal` does not exist.

- [ ] **Step 13: Implement AuthModal**

Create `src/components/auth/AuthModal.tsx`:
```tsx
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
```

- [ ] **Step 14: Run it to verify it passes**

Run: `npx vitest run src/components/auth/AuthModal.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 15: Commit**

```bash
git add src/components/auth/AuthModal.tsx src/components/auth/AuthModal.test.tsx
git commit -m "feat: add AuthModal for sign in/sign up"
```

- [ ] **Step 16: Wire AuthProvider and nav controls into the app shell**

Replace `src/components/layout/AppLayout.tsx`:
```tsx
import { useState } from 'react'
import { Outlet, Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { AuthModal } from '../auth/AuthModal'
import { Button } from '../ui/Button'
import './AppLayout.css'

export function AppLayout() {
  const { user, profile, signOut } = useAuth()
  const [authModalOpen, setAuthModalOpen] = useState(false)

  return (
    <div>
      <nav className="app-nav">
        <Link to="/"><strong>2Fronts</strong></Link>
        <div className="app-nav-links">
          {user ? (
            <>
              <span>{profile?.company_name}</span>
              <Button variant="secondary" onClick={() => signOut()}>Log out</Button>
            </>
          ) : (
            <Button onClick={() => setAuthModalOpen(true)}>Log in / Sign up</Button>
          )}
        </div>
      </nav>
      <main className="app-main">
        <Outlet />
      </main>
      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </div>
  )
}
```

Replace `src/App.tsx`:
```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ToastProvider } from './components/ui/Toast'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { AuthProvider } from './contexts/AuthContext'
import { AppLayout } from './components/layout/AppLayout'
import { NotFoundPage } from './pages/public/NotFoundPage'

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  )
}
```

- [ ] **Step 17: Verify build and lint are clean**

Run: `npm run build && npm run lint`
Expected: both exit 0.

- [ ] **Step 18: Commit**

```bash
git add src/components/layout/AppLayout.tsx src/App.tsx
git commit -m "feat: wire AuthProvider and login/logout controls into app shell"
```

Follow the **End-of-task procedure** from Workflow & Skills now.

---

## Task 3: Public Catalog Browse & Detail

**Files:**
- Create: `src/services/AutomationService.ts`, `src/services/AutomationService.test.ts`
- Create: `src/pages/public/CatalogPage.tsx`, `src/pages/public/CatalogPage.test.tsx`
- Create: `src/pages/public/AutomationDetailPage.tsx`, `src/pages/public/AutomationDetailPage.test.tsx`
- Modify: `src/App.tsx` (add `/` and `/automations/:id` routes)

**Interfaces:**
- Consumes: `supabase` from Task 1; `Automation` type from Task 1; `Card`, `Badge` from Task 1.
- Produces: `listActiveAutomations(): Promise<Automation[]>` and `getAutomationById(id: string): Promise<Automation | null>` in `src/services/AutomationService.ts` — Task 4 imports `getAutomationById`, Task 6 adds more exports to this same file.

### Steps

- [ ] **Step 1: Write the failing test for AutomationService**

Create `src/services/AutomationService.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { listActiveAutomations, getAutomationById } from './AutomationService'

vi.mock('../lib/supabaseClient', () => {
  const sample = {
    id: 'auto-1', name: 'Invoice Sync', summary: 'Syncs invoices', outcome_description: 'Saves 5 hours/week',
    category: 'finance', price_cents: 49900, currency: 'eur', is_active: true, created_at: '2026-06-01T00:00:00Z',
  }
  const chain = {
    order: () => Promise.resolve({ data: [sample], error: null }),
    single: () => Promise.resolve({ data: sample, error: null }),
  }
  return { supabase: { from: () => ({ select: () => ({ eq: () => chain }) }) } }
})

describe('AutomationService', () => {
  it('lists active automations', async () => {
    const result = await listActiveAutomations()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Invoice Sync')
  })

  it('returns a single automation by id', async () => {
    const result = await getAutomationById('auto-1')
    expect(result?.category).toBe('finance')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/services/AutomationService.test.ts`
Expected: FAIL — `./AutomationService` does not exist.

- [ ] **Step 3: Implement AutomationService**

Create `src/services/AutomationService.ts`:
```ts
import { supabase } from '../lib/supabaseClient'
import type { Automation } from '../types/database'

export async function listActiveAutomations(): Promise<Automation[]> {
  const { data, error } = await supabase
    .from('automations')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as Automation[]) ?? []
}

export async function getAutomationById(id: string): Promise<Automation | null> {
  const { data, error } = await supabase.from('automations').select('*').eq('id', id).single()
  if (error) return null
  return data as Automation
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/services/AutomationService.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/AutomationService.ts src/services/AutomationService.test.ts
git commit -m "feat: add AutomationService for catalog reads"
```

- [ ] **Step 6: Write the failing test for CatalogPage**

Create `src/pages/public/CatalogPage.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CatalogPage } from './CatalogPage'
import { listActiveAutomations } from '../../services/AutomationService'

vi.mock('../../services/AutomationService', () => ({ listActiveAutomations: vi.fn() }))

describe('CatalogPage', () => {
  it('renders each active automation with name, category, and price', async () => {
    vi.mocked(listActiveAutomations).mockResolvedValue([
      { id: 'auto-1', name: 'Invoice Sync', summary: 'Syncs invoices', outcome_description: 'x', category: 'finance', price_cents: 49900, currency: 'eur', is_active: true, created_at: '2026-06-01T00:00:00Z' },
    ])
    render(<MemoryRouter><CatalogPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    expect(screen.getByText('finance')).toBeInTheDocument()
  })

  it('shows an empty state when there are no automations', async () => {
    vi.mocked(listActiveAutomations).mockResolvedValue([])
    render(<MemoryRouter><CatalogPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('No automations available yet.')).toBeInTheDocument())
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run src/pages/public/CatalogPage.test.tsx`
Expected: FAIL — `./CatalogPage` does not exist.

- [ ] **Step 8: Implement CatalogPage**

Create `src/pages/public/CatalogPage.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listActiveAutomations } from '../../services/AutomationService'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import type { Automation } from '../../types/database'

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
}

export function CatalogPage() {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listActiveAutomations().then((data) => {
      setAutomations(data)
      setLoading(false)
    })
  }, [])

  if (loading) return <p>Loading catalog...</p>
  if (automations.length === 0) return <p>No automations available yet.</p>

  return (
    <div>
      {automations.map((automation) => (
        <Link key={automation.id} to={`/automations/${automation.id}`} className="catalog-card-link">
          <Card>
            <h3>{automation.name}</h3>
            <p>{automation.summary}</p>
            <Badge>{automation.category}</Badge>
            <p>{formatPrice(automation.price_cents, automation.currency)}</p>
          </Card>
        </Link>
      ))}
    </div>
  )
}
```

Add to `src/index.css`:
```css
.catalog-card-link { text-decoration: none; display: block; margin-bottom: 1rem; color: inherit; }
```

- [ ] **Step 9: Run it to verify it passes**

Run: `npx vitest run src/pages/public/CatalogPage.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 10: Commit**

```bash
git add src/pages/public/CatalogPage.tsx src/index.css
git commit -m "feat: add public catalog browse page"
```

- [ ] **Step 11: Write the failing test for AutomationDetailPage**

Create `src/pages/public/AutomationDetailPage.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AutomationDetailPage } from './AutomationDetailPage'
import { getAutomationById } from '../../services/AutomationService'

vi.mock('../../services/AutomationService', () => ({ getAutomationById: vi.fn() }))

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/automations/${id}`]}>
      <Routes>
        <Route path="/automations/:id" element={<AutomationDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AutomationDetailPage', () => {
  it('renders the outcome description for a found automation', async () => {
    vi.mocked(getAutomationById).mockResolvedValue({
      id: 'auto-1', name: 'Invoice Sync', summary: 'x', outcome_description: 'Saves 5 hours/week',
      category: 'finance', price_cents: 49900, currency: 'eur', is_active: true, created_at: '2026-06-01T00:00:00Z',
    })
    renderAt('auto-1')
    await waitFor(() => expect(screen.getByText('Saves 5 hours/week')).toBeInTheDocument())
  })

  it('shows a not-found message when the automation does not exist', async () => {
    vi.mocked(getAutomationById).mockResolvedValue(null)
    renderAt('missing')
    await waitFor(() => expect(screen.getByText('Automation not found.')).toBeInTheDocument())
  })
})
```

- [ ] **Step 12: Run it to verify it fails**

Run: `npx vitest run src/pages/public/AutomationDetailPage.test.tsx`
Expected: FAIL — `./AutomationDetailPage` does not exist.

- [ ] **Step 13: Implement AutomationDetailPage**

Create `src/pages/public/AutomationDetailPage.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getAutomationById } from '../../services/AutomationService'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import type { Automation } from '../../types/database'

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
}

export function AutomationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [automation, setAutomation] = useState<Automation | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    getAutomationById(id).then((data) => {
      setAutomation(data)
      setLoading(false)
    })
  }, [id])

  if (loading) return <p>Loading...</p>
  if (!automation) return <p>Automation not found.</p>

  return (
    <Card>
      <h2>{automation.name}</h2>
      <Badge>{automation.category}</Badge>
      <p>{automation.outcome_description}</p>
      <p>{formatPrice(automation.price_cents, automation.currency)}</p>
    </Card>
  )
}
```

- [ ] **Step 14: Run it to verify it passes**

Run: `npx vitest run src/pages/public/AutomationDetailPage.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 15: Commit**

```bash
git add src/pages/public/AutomationDetailPage.tsx
git commit -m "feat: add automation detail page"
```

- [ ] **Step 16: Wire the new routes into App.tsx**

Modify `src/App.tsx` — replace the `<Routes>` block:
```tsx
<Routes>
  <Route element={<AppLayout />}>
    <Route path="/" element={<CatalogPage />} />
    <Route path="/automations/:id" element={<AutomationDetailPage />} />
    <Route path="*" element={<NotFoundPage />} />
  </Route>
</Routes>
```
And add these imports at the top of `src/App.tsx`:
```tsx
import { CatalogPage } from './pages/public/CatalogPage'
import { AutomationDetailPage } from './pages/public/AutomationDetailPage'
```

- [ ] **Step 17: Verify build and lint are clean**

Run: `npm run build && npm run lint`
Expected: both exit 0.

- [ ] **Step 18: Commit**

```bash
git add src/App.tsx
git commit -m "feat: route catalog and detail pages"
```

Follow the **End-of-task procedure** from Workflow & Skills now.

---

## Task 4: Request + Stripe Checkout

**Files:**
- Create: `src/services/RequestService.ts`, `src/services/RequestService.test.ts`
- Create: `supabase/functions/create-checkout-session/index.ts`
- Create: `supabase/functions/stripe-webhook/index.ts`
- Create: `src/pages/public/CheckoutResultPage.tsx`, `src/pages/public/CheckoutResultPage.test.tsx`
- Modify: `src/pages/public/AutomationDetailPage.tsx` (add the request/checkout button), `src/pages/public/AutomationDetailPage.test.tsx`
- Modify: `src/App.tsx` (add `/checkout/result` route)

**Interfaces:**
- Consumes: `getAutomationById` (Task 3); `useAuth` (Task 2); `Card`, `Badge`, `Button`, `useToast` (Task 1).
- Produces: `createRequest(automationId: string): Promise<AutomationRequest>`, `createCheckoutSession(requestId: string): Promise<{ url: string }>`, `listMyRequests(): Promise<AutomationRequestWithAutomation[]>` in `src/services/RequestService.ts` — Task 5 imports `listMyRequests`, Task 7 adds `listAllRequests`/`updateRequestStatus` to this same file.

### Steps

- [ ] **Step 1: Write the failing test for RequestService**

Create `src/services/RequestService.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { createRequest, createCheckoutSession, listMyRequests } from './RequestService'

const sampleRequest = {
  id: 'req-1', automation_id: 'auto-1', customer_id: 'user-1', status: 'requested',
  stripe_checkout_session_id: null, delivery_notes: null, requested_at: '2026-06-18T00:00:00Z', paid_at: null, delivered_at: null,
}

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } } })) },
    from: vi.fn(() => ({
      insert: vi.fn(() => ({ select: () => ({ single: () => Promise.resolve({ data: sampleRequest, error: null }) }) })),
      select: vi.fn(() => ({ order: () => Promise.resolve({ data: [sampleRequest], error: null }) })),
    })),
    functions: { invoke: vi.fn(() => Promise.resolve({ data: { url: 'https://checkout.stripe.com/session-1' }, error: null })) },
  },
}))

describe('RequestService', () => {
  it('creates a request tied to the signed-in user', async () => {
    const result = await createRequest('auto-1')
    expect(result.id).toBe('req-1')
  })

  it('throws when no user is signed in', async () => {
    const { supabase } = await import('../lib/supabaseClient')
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({ data: { user: null } } as never)
    await expect(createRequest('auto-1')).rejects.toThrow('Must be signed in to request an automation')
  })

  it('invokes the create-checkout-session function and returns its url', async () => {
    const result = await createCheckoutSession('req-1')
    expect(result.url).toBe('https://checkout.stripe.com/session-1')
  })

  it("lists the current user's requests with their automation joined", async () => {
    const result = await listMyRequests()
    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('requested')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/services/RequestService.test.ts`
Expected: FAIL — `./RequestService` does not exist.

- [ ] **Step 3: Implement RequestService**

Create `src/services/RequestService.ts`:
```ts
import { supabase } from '../lib/supabaseClient'
import type { AutomationRequest, AutomationRequestWithAutomation } from '../types/database'

export async function createRequest(automationId: string): Promise<AutomationRequest> {
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) throw new Error('Must be signed in to request an automation')

  const { data, error } = await supabase
    .from('automation_requests')
    .insert({ automation_id: automationId, customer_id: userId })
    .select()
    .single()
  if (error) throw error
  return data as AutomationRequest
}

export async function createCheckoutSession(requestId: string): Promise<{ url: string }> {
  const { data, error } = await supabase.functions.invoke('create-checkout-session', {
    body: { requestId },
  })
  if (error) throw error
  return data as { url: string }
}

export async function listMyRequests(): Promise<AutomationRequestWithAutomation[]> {
  const { data, error } = await supabase
    .from('automation_requests')
    .select('*, automation:automations(*)')
    .order('requested_at', { ascending: false })
  if (error) throw error
  return (data as AutomationRequestWithAutomation[]) ?? []
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/services/RequestService.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/RequestService.ts src/services/RequestService.test.ts
git commit -m "feat: add RequestService for creating and listing requests"
```

- [ ] **Step 6: Implement the create-checkout-session edge function**

Before writing this, check current API shapes against https://docs.stripe.com/checkout/quickstart and https://supabase.com/docs/guides/functions — the snippet below matches Stripe API version `2024-06-20` and the Supabase Edge Functions `npm:` specifier convention current as of this plan; re-verify if either has changed.

Create `supabase/functions/create-checkout-session/index.ts`:
```ts
import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@16'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  const { requestId } = await req.json()
  if (!requestId) {
    return new Response(JSON.stringify({ error: 'requestId is required' }), { status: 400 })
  }

  // RLS on automation_requests ("customers read own requests") guarantees this
  // only returns a row if the authenticated caller owns it.
  const { data: requestRow, error: requestError } = await userClient
    .from('automation_requests')
    .select('id, automations(name, price_cents, currency)')
    .eq('id', requestId)
    .single()

  if (requestError || !requestRow) {
    return new Response(JSON.stringify({ error: 'Request not found' }), { status: 404 })
  }

  const automation = requestRow.automations as unknown as { name: string; price_cents: number; currency: string }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: automation.currency,
        unit_amount: automation.price_cents,
        product_data: { name: automation.name },
      },
      quantity: 1,
    }],
    metadata: { request_id: requestId },
    success_url: `${Deno.env.get('PUBLIC_APP_URL')}/checkout/result?status=success`,
    cancel_url: `${Deno.env.get('PUBLIC_APP_URL')}/checkout/result?status=cancelled`,
  })

  // Service-role client: customers have no UPDATE policy on automation_requests by
  // design (see migration), so this transition is performed server-side only.
  const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  await adminClient
    .from('automation_requests')
    .update({ status: 'payment_pending', stripe_checkout_session_id: session.id })
    .eq('id', requestId)

  return new Response(JSON.stringify({ url: session.url }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

- [ ] **Step 7: Implement the stripe-webhook edge function**

Re-verify the signature-verification call against https://docs.stripe.com/webhooks before implementing — Stripe's recommended verification method occasionally changes name across SDK versions.

Create `supabase/functions/stripe-webhook/index.ts`:
```ts
import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@16'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature') ?? ''
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret)
  } catch {
    return new Response('Invalid signature', { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const requestId = session.metadata?.request_id
    if (requestId) {
      const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      await adminClient
        .from('automation_requests')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
        .eq('id', requestId)
        .eq('stripe_checkout_session_id', session.id)
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 })
})
```

- [ ] **Step 8: Verify the edge functions manually (no Vitest runtime for Deno functions)**

Run locally:
```bash
supabase functions serve create-checkout-session stripe-webhook --env-file supabase/.env.local
```
In another terminal, with a real signed-in user's JWT and an existing `automation_requests.id`:
```bash
curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/create-checkout-session' \
  --header "Authorization: Bearer <user-jwt>" \
  --header 'Content-Type: application/json' \
  --data '{"requestId":"<existing-request-id>"}'
```
Expected: `200` with a JSON body containing a `url` starting with `https://checkout.stripe.com/`.

To exercise the webhook, use the Stripe CLI:
```bash
stripe listen --forward-to 127.0.0.1:54321/functions/v1/stripe-webhook
stripe trigger checkout.session.completed
```
Expected: the corresponding `automation_requests` row's `status` becomes `paid` and `paid_at` is set.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions
git commit -m "feat: add Stripe checkout session and webhook edge functions"
```

- [ ] **Step 10: Write the failing test for CheckoutResultPage**

Create `src/pages/public/CheckoutResultPage.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CheckoutResultPage } from './CheckoutResultPage'

describe('CheckoutResultPage', () => {
  it('shows a success message for status=success', () => {
    render(
      <MemoryRouter initialEntries={['/checkout/result?status=success']}>
        <CheckoutResultPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Payment received')).toBeInTheDocument()
  })

  it('shows a cancellation message for status=cancelled', () => {
    render(
      <MemoryRouter initialEntries={['/checkout/result?status=cancelled']}>
        <CheckoutResultPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Checkout cancelled')).toBeInTheDocument()
  })
})
```

- [ ] **Step 11: Run it to verify it fails**

Run: `npx vitest run src/pages/public/CheckoutResultPage.test.tsx`
Expected: FAIL — `./CheckoutResultPage` does not exist.

- [ ] **Step 12: Implement CheckoutResultPage**

Create `src/pages/public/CheckoutResultPage.tsx`:
```tsx
import { useSearchParams, Link } from 'react-router-dom'

export function CheckoutResultPage() {
  const [searchParams] = useSearchParams()
  const status = searchParams.get('status')

  if (status === 'success') {
    return (
      <div>
        <h2>Payment received</h2>
        <p>We'll start fulfilling your automation shortly. Track its status in My Requests.</p>
        <Link to="/">Back to catalog</Link>
      </div>
    )
  }

  return (
    <div>
      <h2>Checkout cancelled</h2>
      <p>No payment was made. You can try again any time.</p>
      <Link to="/">Back to catalog</Link>
    </div>
  )
}
```

- [ ] **Step 13: Run it to verify it passes**

Run: `npx vitest run src/pages/public/CheckoutResultPage.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 14: Commit**

```bash
git add src/pages/public/CheckoutResultPage.tsx src/pages/public/CheckoutResultPage.test.tsx
git commit -m "feat: add checkout result page"
```

- [ ] **Step 15: Write the failing tests for the request button on AutomationDetailPage**

Replace `src/pages/public/AutomationDetailPage.test.tsx` entirely:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AutomationDetailPage } from './AutomationDetailPage'
import { getAutomationById } from '../../services/AutomationService'
import { createRequest, createCheckoutSession } from '../../services/RequestService'
import { useAuth } from '../../contexts/AuthContext'
import { ToastProvider } from '../../components/ui/Toast'

vi.mock('../../services/AutomationService', () => ({ getAutomationById: vi.fn() }))
vi.mock('../../services/RequestService', () => ({ createRequest: vi.fn(), createCheckoutSession: vi.fn() }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))

const sampleAutomation = {
  id: 'auto-1', name: 'Invoice Sync', summary: 'x', outcome_description: 'Saves 5 hours/week',
  category: 'finance', price_cents: 49900, currency: 'eur', is_active: true, created_at: '2026-06-01T00:00:00Z',
}

function renderAt(id: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/automations/${id}`]}>
        <Routes>
          <Route path="/automations/:id" element={<AutomationDetailPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  )
}

describe('AutomationDetailPage', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', { value: { href: '' }, writable: true })
  })

  it('renders the outcome description for a found automation', async () => {
    vi.mocked(getAutomationById).mockResolvedValue(sampleAutomation)
    vi.mocked(useAuth).mockReturnValue({ user: null, profile: null, loading: false, signUp: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })
    renderAt('auto-1')
    await waitFor(() => expect(screen.getByText('Saves 5 hours/week')).toBeInTheDocument())
  })

  it('shows a not-found message when the automation does not exist', async () => {
    vi.mocked(getAutomationById).mockResolvedValue(null)
    vi.mocked(useAuth).mockReturnValue({ user: null, profile: null, loading: false, signUp: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })
    renderAt('missing')
    await waitFor(() => expect(screen.getByText('Automation not found.')).toBeInTheDocument())
  })

  it('prompts signed-out visitors to log in instead of showing the request button', async () => {
    vi.mocked(getAutomationById).mockResolvedValue(sampleAutomation)
    vi.mocked(useAuth).mockReturnValue({ user: null, profile: null, loading: false, signUp: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })
    renderAt('auto-1')
    await waitFor(() => expect(screen.getByText('Log in to request this automation.')).toBeInTheDocument())
  })

  it('creates a request, starts checkout, and redirects to the Stripe URL', async () => {
    vi.mocked(getAutomationById).mockResolvedValue(sampleAutomation)
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'user-1' } as never, profile: null, loading: false, signUp: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })
    vi.mocked(createRequest).mockResolvedValue({
      id: 'req-1', automation_id: 'auto-1', customer_id: 'user-1', status: 'requested',
      stripe_checkout_session_id: null, delivery_notes: null, requested_at: '2026-06-18T00:00:00Z', paid_at: null, delivered_at: null,
    })
    vi.mocked(createCheckoutSession).mockResolvedValue({ url: 'https://checkout.stripe.com/session-1' })
    renderAt('auto-1')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Request this automation' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Request this automation' }))
    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalledWith('req-1'))
    await waitFor(() => expect(window.location.href).toBe('https://checkout.stripe.com/session-1'))
  })
})
```

- [ ] **Step 16: Run it to verify it fails**

Run: `npx vitest run src/pages/public/AutomationDetailPage.test.tsx`
Expected: FAIL — the request button does not exist yet on `AutomationDetailPage`.

- [ ] **Step 17: Implement the request/checkout button**

Replace `src/pages/public/AutomationDetailPage.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getAutomationById } from '../../services/AutomationService'
import { createRequest, createCheckoutSession } from '../../services/RequestService'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/ui/Toast'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import type { Automation } from '../../types/database'

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
}

export function AutomationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { showToast } = useToast()
  const [automation, setAutomation] = useState<Automation | null>(null)
  const [loading, setLoading] = useState(true)
  const [requesting, setRequesting] = useState(false)

  useEffect(() => {
    if (!id) return
    getAutomationById(id).then((data) => {
      setAutomation(data)
      setLoading(false)
    })
  }, [id])

  async function handleRequest() {
    if (!automation) return
    setRequesting(true)
    try {
      const request = await createRequest(automation.id)
      const { url } = await createCheckoutSession(request.id)
      window.location.href = url
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not start checkout', 'error')
      setRequesting(false)
    }
  }

  if (loading) return <p>Loading...</p>
  if (!automation) return <p>Automation not found.</p>

  return (
    <Card>
      <h2>{automation.name}</h2>
      <Badge>{automation.category}</Badge>
      <p>{automation.outcome_description}</p>
      <p>{formatPrice(automation.price_cents, automation.currency)}</p>
      {user ? (
        <Button onClick={handleRequest} disabled={requesting}>
          {requesting ? 'Starting checkout...' : 'Request this automation'}
        </Button>
      ) : (
        <p>Log in to request this automation.</p>
      )}
    </Card>
  )
}
```

- [ ] **Step 18: Run it to verify it passes**

Run: `npx vitest run src/pages/public/AutomationDetailPage.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 19: Commit**

```bash
git add src/pages/public/AutomationDetailPage.tsx src/pages/public/AutomationDetailPage.test.tsx
git commit -m "feat: add request and checkout button to automation detail page"
```

- [ ] **Step 20: Wire the result route and required env vars**

Modify `src/App.tsx` — add the import `import { CheckoutResultPage } from './pages/public/CheckoutResultPage'` and the route `<Route path="/checkout/result" element={<CheckoutResultPage />} />` inside the existing `<Route element={<AppLayout />}>` block, alongside the catalog/detail routes.

Add to `.env.example`:
```
PUBLIC_APP_URL=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```
(These three are edge-function secrets, set via `supabase secrets set`, not `VITE_`-prefixed client env vars — they must never reach the browser bundle.)

- [ ] **Step 21: Verify build and lint are clean**

Run: `npm run build && npm run lint`
Expected: both exit 0.

- [ ] **Step 22: Commit**

```bash
git add src/App.tsx .env.example
git commit -m "feat: route checkout result page and document edge function secrets"
```

Follow the **End-of-task procedure** from Workflow & Skills now. Pay extra attention to the Security Checklist for this task: confirm the webhook verifies its signature, the price is read server-side, and no secret key is reachable from `src/`.

---

## Task 5: Customer "My Requests" Dashboard

**Files:**
- Create: `src/pages/customer/MyRequestsPage.tsx`, `src/pages/customer/MyRequestsPage.test.tsx`
- Modify: `src/App.tsx` (add `/my-requests` behind `ProtectedRoute`), `src/components/layout/AppLayout.tsx` (add nav link)

**Interfaces:**
- Consumes: `listMyRequests` (Task 4); `ProtectedRoute` (Task 2); `Card`, `Badge` (Task 1); `AutomationRequestWithAutomation`, `RequestStatus` (Task 1).

### Steps

- [ ] **Step 1: Write the failing test for MyRequestsPage**

Create `src/pages/customer/MyRequestsPage.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MyRequestsPage } from './MyRequestsPage'
import { listMyRequests } from '../../services/RequestService'

vi.mock('../../services/RequestService', () => ({ listMyRequests: vi.fn() }))

const baseRequest = {
  id: 'req-1', automation_id: 'auto-1', customer_id: 'user-1',
  stripe_checkout_session_id: 'sess-1', requested_at: '2026-06-18T00:00:00Z', paid_at: null, delivered_at: null,
  automation: { id: 'auto-1', name: 'Invoice Sync', summary: 'x', outcome_description: 'y', category: 'finance', price_cents: 49900, currency: 'eur', is_active: true, created_at: '2026-06-01T00:00:00Z' },
}

describe('MyRequestsPage', () => {
  it('renders the automation name and status badge for each request', async () => {
    vi.mocked(listMyRequests).mockResolvedValue([{ ...baseRequest, status: 'paid', delivery_notes: null }])
    render(<MyRequestsPage />)
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    expect(screen.getByText('paid')).toBeInTheDocument()
  })

  it('shows delivery notes once a request is delivered', async () => {
    vi.mocked(listMyRequests).mockResolvedValue([{ ...baseRequest, status: 'delivered', delivery_notes: 'Connected to your Gmail and HubSpot.' }])
    render(<MyRequestsPage />)
    await waitFor(() => expect(screen.getByText('Connected to your Gmail and HubSpot.')).toBeInTheDocument())
  })

  it('shows an empty state when there are no requests', async () => {
    vi.mocked(listMyRequests).mockResolvedValue([])
    render(<MyRequestsPage />)
    await waitFor(() => expect(screen.getByText("You haven't requested any automations yet.")).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/pages/customer/MyRequestsPage.test.tsx`
Expected: FAIL — `./MyRequestsPage` does not exist.

- [ ] **Step 3: Implement MyRequestsPage**

Create `src/pages/customer/MyRequestsPage.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { listMyRequests } from '../../services/RequestService'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import type { AutomationRequestWithAutomation, RequestStatus } from '../../types/database'

const STATUS_TONE: Record<RequestStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  requested: 'neutral',
  payment_pending: 'neutral',
  paid: 'warning',
  in_progress: 'warning',
  delivered: 'success',
  cancelled: 'danger',
}

export function MyRequestsPage() {
  const [requests, setRequests] = useState<AutomationRequestWithAutomation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listMyRequests().then((data) => {
      setRequests(data)
      setLoading(false)
    })
  }, [])

  if (loading) return <p>Loading your requests...</p>
  if (requests.length === 0) return <p>You haven't requested any automations yet.</p>

  return (
    <div>
      {requests.map((request) => (
        <Card key={request.id} className="my-requests-card">
          <h3>{request.automation.name}</h3>
          <Badge tone={STATUS_TONE[request.status]}>{request.status}</Badge>
          {request.status === 'delivered' && request.delivery_notes && <p>{request.delivery_notes}</p>}
        </Card>
      ))}
    </div>
  )
}
```

Add to `src/index.css`:
```css
.my-requests-card { margin-bottom: 1rem; }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/pages/customer/MyRequestsPage.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/pages/customer/MyRequestsPage.tsx src/index.css
git commit -m "feat: add customer My Requests dashboard"
```

- [ ] **Step 6: Wire the protected route and nav link**

Modify `src/App.tsx` — add the imports:
```tsx
import { ProtectedRoute } from './components/auth/ProtectedRoute'
import { MyRequestsPage } from './pages/customer/MyRequestsPage'
```
And update the `<Routes>` block to:
```tsx
<Routes>
  <Route element={<AppLayout />}>
    <Route path="/" element={<CatalogPage />} />
    <Route path="/automations/:id" element={<AutomationDetailPage />} />
    <Route path="/checkout/result" element={<CheckoutResultPage />} />
    <Route element={<ProtectedRoute />}>
      <Route path="/my-requests" element={<MyRequestsPage />} />
    </Route>
    <Route path="*" element={<NotFoundPage />} />
  </Route>
</Routes>
```

Modify `src/components/layout/AppLayout.tsx` — update the signed-in branch of the nav:
```tsx
{user ? (
  <>
    <Link to="/my-requests">My Requests</Link>
    <span>{profile?.company_name}</span>
    <Button variant="secondary" onClick={() => signOut()}>Log out</Button>
  </>
) : (
  <Button onClick={() => setAuthModalOpen(true)}>Log in / Sign up</Button>
)}
```

- [ ] **Step 7: Verify build and lint are clean**

Run: `npm run build && npm run lint`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/components/layout/AppLayout.tsx
git commit -m "feat: route My Requests behind auth and link it from the nav"
```

Follow the **End-of-task procedure** from Workflow & Skills now.

---

## Task 6: Admin Catalog CRUD

**Files:**
- Modify: `src/services/AutomationService.ts`, `src/services/AutomationService.test.ts` (add `listAllAutomations`, `createAutomation`, `updateAutomation`)
- Create: `src/pages/admin/AdminCatalogPage.tsx`, `src/pages/admin/AdminCatalogPage.test.tsx`
- Modify: `src/App.tsx` (add `/admin/automations` behind `ProtectedRoute requireRole="admin"`), `src/components/layout/AppLayout.tsx` (add admin nav link)

**Interfaces:**
- Consumes: `ProtectedRoute` (Task 2); `Card`, `Badge`, `Input`, `Button`, `useToast` (Task 1).
- Produces: `listAllAutomations(): Promise<Automation[]>`, `createAutomation(input: NewAutomationInput): Promise<Automation>`, `updateAutomation(id, patch: Partial<NewAutomationInput> & { is_active?: boolean }): Promise<Automation>`, and the `NewAutomationInput` type, added to `src/services/AutomationService.ts`.

### Steps

- [ ] **Step 1: Write the failing tests for the new AutomationService exports**

Replace `src/services/AutomationService.test.ts` entirely:
```ts
import { describe, it, expect, vi } from 'vitest'
import { listActiveAutomations, getAutomationById, listAllAutomations, createAutomation, updateAutomation } from './AutomationService'

const sample = {
  id: 'auto-1', name: 'Invoice Sync', summary: 'Syncs invoices', outcome_description: 'Saves 5 hours/week',
  category: 'finance', price_cents: 49900, currency: 'eur', is_active: true, created_at: '2026-06-01T00:00:00Z',
}

vi.mock('../lib/supabaseClient', () => {
  const selectChain = {
    eq: () => ({
      order: () => Promise.resolve({ data: [sample], error: null }),
      single: () => Promise.resolve({ data: sample, error: null }),
    }),
    order: () => Promise.resolve({ data: [sample], error: null }),
  }
  const insertChain = { select: () => ({ single: () => Promise.resolve({ data: sample, error: null }) }) }
  const updateChain = {
    eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: { ...sample, name: 'Updated' }, error: null }) }) }),
  }
  return {
    supabase: {
      from: () => ({ select: () => selectChain, insert: () => insertChain, update: () => updateChain }),
    },
  }
})

describe('AutomationService', () => {
  it('lists active automations', async () => {
    expect(await listActiveAutomations()).toHaveLength(1)
  })

  it('returns a single automation by id', async () => {
    expect((await getAutomationById('auto-1'))?.category).toBe('finance')
  })

  it('lists all automations including inactive ones, for admins', async () => {
    expect(await listAllAutomations()).toHaveLength(1)
  })

  it('creates a new automation defaulting currency to eur', async () => {
    const result = await createAutomation({
      name: 'Invoice Sync', summary: 'Syncs invoices', outcome_description: 'Saves time', category: 'finance', price_cents: 49900,
    })
    expect(result.id).toBe('auto-1')
  })

  it('updates an existing automation', async () => {
    const result = await updateAutomation('auto-1', { name: 'Updated' })
    expect(result.name).toBe('Updated')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/services/AutomationService.test.ts`
Expected: FAIL — `listAllAutomations`, `createAutomation`, `updateAutomation` are not exported yet.

- [ ] **Step 3: Implement the new AutomationService exports**

Replace `src/services/AutomationService.ts` entirely:
```ts
import { supabase } from '../lib/supabaseClient'
import type { Automation } from '../types/database'

export interface NewAutomationInput {
  name: string
  summary: string
  outcome_description: string
  category: string
  price_cents: number
  currency?: string
}

export async function listActiveAutomations(): Promise<Automation[]> {
  const { data, error } = await supabase
    .from('automations')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as Automation[]) ?? []
}

export async function getAutomationById(id: string): Promise<Automation | null> {
  const { data, error } = await supabase.from('automations').select('*').eq('id', id).single()
  if (error) return null
  return data as Automation
}

export async function listAllAutomations(): Promise<Automation[]> {
  const { data, error } = await supabase.from('automations').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return (data as Automation[]) ?? []
}

export async function createAutomation(input: NewAutomationInput): Promise<Automation> {
  const { data, error } = await supabase
    .from('automations')
    .insert({ ...input, currency: input.currency ?? 'eur' })
    .select()
    .single()
  if (error) throw error
  return data as Automation
}

export async function updateAutomation(
  id: string,
  patch: Partial<NewAutomationInput> & { is_active?: boolean }
): Promise<Automation> {
  const { data, error } = await supabase.from('automations').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data as Automation
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/services/AutomationService.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/AutomationService.ts src/services/AutomationService.test.ts
git commit -m "feat: add admin CRUD operations to AutomationService"
```

- [ ] **Step 6: Write the failing test for AdminCatalogPage**

Create `src/pages/admin/AdminCatalogPage.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AdminCatalogPage } from './AdminCatalogPage'
import { listAllAutomations, createAutomation, updateAutomation } from '../../services/AutomationService'
import { ToastProvider } from '../../components/ui/Toast'

vi.mock('../../services/AutomationService', () => ({
  listAllAutomations: vi.fn(),
  createAutomation: vi.fn(),
  updateAutomation: vi.fn(),
}))

const sample = {
  id: 'auto-1', name: 'Invoice Sync', summary: 'x', outcome_description: 'y', category: 'finance',
  price_cents: 49900, currency: 'eur', is_active: true, created_at: '2026-06-01T00:00:00Z',
}

function renderPage() {
  return render(<ToastProvider><AdminCatalogPage /></ToastProvider>)
}

describe('AdminCatalogPage', () => {
  it('lists existing automations with their active status', async () => {
    vi.mocked(listAllAutomations).mockResolvedValue([sample])
    renderPage()
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    expect(screen.getByText('active')).toBeInTheDocument()
  })

  it('submits the form to create a new automation and refreshes the list', async () => {
    vi.mocked(listAllAutomations).mockResolvedValue([])
    vi.mocked(createAutomation).mockResolvedValue(sample)
    renderPage()
    await waitFor(() => expect(listAllAutomations).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Invoice Sync' } })
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText('Outcome description'), { target: { value: 'y' } })
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'finance' } })
    fireEvent.change(screen.getByLabelText('Price (cents)'), { target: { value: '49900' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add automation' }))
    await waitFor(() =>
      expect(createAutomation).toHaveBeenCalledWith({
        name: 'Invoice Sync', summary: 'x', outcome_description: 'y', category: 'finance', price_cents: 49900,
      })
    )
  })

  it('toggles an automation to inactive when Deactivate is clicked', async () => {
    vi.mocked(listAllAutomations).mockResolvedValue([sample])
    vi.mocked(updateAutomation).mockResolvedValue({ ...sample, is_active: false })
    renderPage()
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
    await waitFor(() => expect(updateAutomation).toHaveBeenCalledWith('auto-1', { is_active: false }))
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run src/pages/admin/AdminCatalogPage.test.tsx`
Expected: FAIL — `./AdminCatalogPage` does not exist.

- [ ] **Step 8: Implement AdminCatalogPage**

Create `src/pages/admin/AdminCatalogPage.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { listAllAutomations, createAutomation, updateAutomation, type NewAutomationInput } from '../../services/AutomationService'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import type { Automation } from '../../types/database'

const EMPTY_FORM: NewAutomationInput = { name: '', summary: '', outcome_description: '', category: '', price_cents: 0 }

export function AdminCatalogPage() {
  const { showToast } = useToast()
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<NewAutomationInput>(EMPTY_FORM)

  async function refresh() {
    setAutomations(await listAllAutomations())
    setLoading(false)
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleCreate() {
    await createAutomation(form)
    setForm(EMPTY_FORM)
    showToast('Automation added')
    await refresh()
  }

  async function toggleActive(automation: Automation) {
    await updateAutomation(automation.id, { is_active: !automation.is_active })
    await refresh()
  }

  if (loading) return <p>Loading catalog...</p>

  return (
    <div>
      <Card>
        <h3>Add automation</h3>
        <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input label="Summary" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
        <Input label="Outcome description" value={form.outcome_description} onChange={(e) => setForm({ ...form, outcome_description: e.target.value })} />
        <Input label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <Input label="Price (cents)" type="number" value={form.price_cents} onChange={(e) => setForm({ ...form, price_cents: Number(e.target.value) })} />
        <Button onClick={handleCreate}>Add automation</Button>
      </Card>

      {automations.map((automation) => (
        <Card key={automation.id} className="my-requests-card">
          <h3>{automation.name}</h3>
          <Badge tone={automation.is_active ? 'success' : 'neutral'}>{automation.is_active ? 'active' : 'inactive'}</Badge>
          <Button variant="secondary" onClick={() => toggleActive(automation)}>
            {automation.is_active ? 'Deactivate' : 'Activate'}
          </Button>
        </Card>
      ))}
    </div>
  )
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `npx vitest run src/pages/admin/AdminCatalogPage.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 10: Commit**

```bash
git add src/pages/admin/AdminCatalogPage.tsx
git commit -m "feat: add admin catalog CRUD page"
```

- [ ] **Step 11: Wire the admin route and nav link**

Modify `src/App.tsx` — add the import `import { AdminCatalogPage } from './pages/admin/AdminCatalogPage'` and add a second `ProtectedRoute` block to the `<Routes>`:
```tsx
<Route element={<ProtectedRoute requireRole="admin" />}>
  <Route path="/admin/automations" element={<AdminCatalogPage />} />
</Route>
```
placed alongside (not nested inside) the existing customer `ProtectedRoute` block, both still inside `<Route element={<AppLayout />}>`.

Modify `src/components/layout/AppLayout.tsx` — update the signed-in nav branch to show an admin link:
```tsx
{user ? (
  <>
    {profile?.role === 'admin' && <Link to="/admin/automations">Admin</Link>}
    <Link to="/my-requests">My Requests</Link>
    <span>{profile?.company_name}</span>
    <Button variant="secondary" onClick={() => signOut()}>Log out</Button>
  </>
) : (
  <Button onClick={() => setAuthModalOpen(true)}>Log in / Sign up</Button>
)}
```

- [ ] **Step 12: Verify build and lint are clean**

Run: `npm run build && npm run lint`
Expected: both exit 0.

- [ ] **Step 13: Commit**

```bash
git add src/App.tsx src/components/layout/AppLayout.tsx
git commit -m "feat: route admin catalog page and link it from the nav for admins"
```

Follow the **End-of-task procedure** from Workflow & Skills now.

---

## Task 7: Admin Request Management

**Files:**
- Modify: `src/services/RequestService.ts`, `src/services/RequestService.test.ts` (add `listAllRequests`, `updateRequestStatus`)
- Create: `src/pages/admin/AdminRequestsPage.tsx`, `src/pages/admin/AdminRequestsPage.test.tsx`
- Modify: `src/App.tsx` (add `/admin/requests`), `src/components/layout/AppLayout.tsx` (add nav link)

**Interfaces:**
- Consumes: `ProtectedRoute` (Task 2); `Card`, `Badge`, `Input`, `Button`, `useToast` (Task 1); `AutomationRequestWithAutomation`, `RequestStatus` (Task 1).
- Produces: `listAllRequests(filter?: { status?: RequestStatus }): Promise<AutomationRequestWithAutomation[]>` and `updateRequestStatus(id: string, status: RequestStatus, deliveryNotes?: string): Promise<AutomationRequest>`, added to `src/services/RequestService.ts`.

### Steps

- [ ] **Step 1: Write the failing tests for the new RequestService exports**

Replace `src/services/RequestService.test.ts` entirely:
```ts
import { describe, it, expect, vi } from 'vitest'
import { createRequest, createCheckoutSession, listMyRequests, listAllRequests, updateRequestStatus } from './RequestService'

vi.mock('../lib/supabaseClient', () => {
  const sampleRequest = {
    id: 'req-1', automation_id: 'auto-1', customer_id: 'user-1', status: 'requested',
    stripe_checkout_session_id: null, delivery_notes: null, requested_at: '2026-06-18T00:00:00Z', paid_at: null, delivered_at: null,
  }
  const sampleRequestWithAutomation = {
    ...sampleRequest,
    automation: { id: 'auto-1', name: 'Invoice Sync', summary: 'x', outcome_description: 'y', category: 'finance', price_cents: 49900, currency: 'eur', is_active: true, created_at: '2026-06-01T00:00:00Z' },
  }

  function chainableList(data: unknown[]) {
    const promise = Promise.resolve({ data, error: null }) as Promise<{ data: unknown[]; error: null }> & {
      eq: (col: string, val: unknown) => Promise<{ data: unknown[]; error: null }>
    }
    promise.eq = () => Promise.resolve({ data, error: null })
    return promise
  }

  return {
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
      from: () => ({
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: sampleRequest, error: null }) }) }),
        select: () => ({ order: () => chainableList([sampleRequestWithAutomation]) }),
        update: () => ({
          eq: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { ...sampleRequest, status: 'delivered', delivery_notes: 'Done' }, error: null }),
            }),
          }),
        }),
      }),
      functions: { invoke: () => Promise.resolve({ data: { url: 'https://checkout.stripe.com/session-1' }, error: null }) },
    },
  }
})

describe('RequestService', () => {
  it('creates a request tied to the signed-in user', async () => {
    const result = await createRequest('auto-1')
    expect(result.id).toBe('req-1')
  })

  it('throws when no user is signed in', async () => {
    const { supabase } = await import('../lib/supabaseClient')
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValueOnce({ data: { user: null } } as never)
    await expect(createRequest('auto-1')).rejects.toThrow('Must be signed in to request an automation')
  })

  it('invokes the create-checkout-session function and returns its url', async () => {
    const result = await createCheckoutSession('req-1')
    expect(result.url).toBe('https://checkout.stripe.com/session-1')
  })

  it("lists the current user's requests with their automation joined", async () => {
    const result = await listMyRequests()
    expect(result).toHaveLength(1)
  })

  it('lists all requests with their automation joined', async () => {
    const result = await listAllRequests()
    expect(result[0].automation.name).toBe('Invoice Sync')
  })

  it('filters requests by status when provided', async () => {
    const result = await listAllRequests({ status: 'paid' })
    expect(result).toHaveLength(1)
  })

  it('updates a request status and records delivery notes', async () => {
    const result = await updateRequestStatus('req-1', 'delivered', 'Done')
    expect(result.status).toBe('delivered')
    expect(result.delivery_notes).toBe('Done')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/services/RequestService.test.ts`
Expected: FAIL — `listAllRequests`, `updateRequestStatus` are not exported yet.

- [ ] **Step 3: Implement the new RequestService exports**

Replace `src/services/RequestService.ts` entirely:
```ts
import { supabase } from '../lib/supabaseClient'
import type { AutomationRequest, AutomationRequestWithAutomation, RequestStatus } from '../types/database'

export async function createRequest(automationId: string): Promise<AutomationRequest> {
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) throw new Error('Must be signed in to request an automation')

  const { data, error } = await supabase
    .from('automation_requests')
    .insert({ automation_id: automationId, customer_id: userId })
    .select()
    .single()
  if (error) throw error
  return data as AutomationRequest
}

export async function createCheckoutSession(requestId: string): Promise<{ url: string }> {
  const { data, error } = await supabase.functions.invoke('create-checkout-session', { body: { requestId } })
  if (error) throw error
  return data as { url: string }
}

export async function listMyRequests(): Promise<AutomationRequestWithAutomation[]> {
  const { data, error } = await supabase
    .from('automation_requests')
    .select('*, automation:automations(*)')
    .order('requested_at', { ascending: false })
  if (error) throw error
  return (data as AutomationRequestWithAutomation[]) ?? []
}

export async function listAllRequests(filter?: { status?: RequestStatus }): Promise<AutomationRequestWithAutomation[]> {
  let query = supabase
    .from('automation_requests')
    .select('*, automation:automations(*)')
    .order('requested_at', { ascending: false })
  if (filter?.status) {
    query = query.eq('status', filter.status)
  }
  const { data, error } = await query
  if (error) throw error
  return (data as AutomationRequestWithAutomation[]) ?? []
}

export async function updateRequestStatus(
  id: string,
  status: RequestStatus,
  deliveryNotes?: string
): Promise<AutomationRequest> {
  const patch: Partial<AutomationRequest> = { status }
  if (deliveryNotes !== undefined) patch.delivery_notes = deliveryNotes
  if (status === 'delivered') patch.delivered_at = new Date().toISOString()

  const { data, error } = await supabase.from('automation_requests').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data as AutomationRequest
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/services/RequestService.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/RequestService.ts src/services/RequestService.test.ts
git commit -m "feat: add admin listing and status update to RequestService"
```

- [ ] **Step 6: Write the failing test for AdminRequestsPage**

Create `src/pages/admin/AdminRequestsPage.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AdminRequestsPage } from './AdminRequestsPage'
import { listAllRequests, updateRequestStatus } from '../../services/RequestService'
import { ToastProvider } from '../../components/ui/Toast'

vi.mock('../../services/RequestService', () => ({ listAllRequests: vi.fn(), updateRequestStatus: vi.fn() }))

const baseRequest = {
  id: 'req-1', automation_id: 'auto-1', customer_id: 'user-1', stripe_checkout_session_id: 'sess-1',
  delivery_notes: null, requested_at: '2026-06-18T00:00:00Z', paid_at: '2026-06-18T01:00:00Z', delivered_at: null,
  automation: { id: 'auto-1', name: 'Invoice Sync', summary: 'x', outcome_description: 'y', category: 'finance', price_cents: 49900, currency: 'eur', is_active: true, created_at: '2026-06-01T00:00:00Z' },
}

function renderPage() {
  return render(<ToastProvider><AdminRequestsPage /></ToastProvider>)
}

describe('AdminRequestsPage', () => {
  it('shows the next-status action for a paid request', async () => {
    vi.mocked(listAllRequests).mockResolvedValue([{ ...baseRequest, status: 'paid' }])
    renderPage()
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Mark in_progress' })).toBeInTheDocument()
  })

  it('shows a delivery notes field and advances to delivered with notes', async () => {
    vi.mocked(listAllRequests).mockResolvedValue([{ ...baseRequest, status: 'in_progress' }])
    vi.mocked(updateRequestStatus).mockResolvedValue({ ...baseRequest, status: 'delivered' })
    renderPage()
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Delivery notes'), { target: { value: 'Connected Gmail + HubSpot' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mark delivered' }))
    await waitFor(() =>
      expect(updateRequestStatus).toHaveBeenCalledWith('req-1', 'delivered', 'Connected Gmail + HubSpot')
    )
  })

  it('shows no action button for a delivered request', async () => {
    vi.mocked(listAllRequests).mockResolvedValue([{ ...baseRequest, status: 'delivered' }])
    renderPage()
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows an empty state when there are no requests', async () => {
    vi.mocked(listAllRequests).mockResolvedValue([])
    renderPage()
    await waitFor(() => expect(screen.getByText('No requests yet.')).toBeInTheDocument())
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run src/pages/admin/AdminRequestsPage.test.tsx`
Expected: FAIL — `./AdminRequestsPage` does not exist.

- [ ] **Step 8: Implement AdminRequestsPage**

Create `src/pages/admin/AdminRequestsPage.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { listAllRequests, updateRequestStatus } from '../../services/RequestService'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import type { AutomationRequestWithAutomation, RequestStatus } from '../../types/database'

const STATUS_TONE: Record<RequestStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  requested: 'neutral', payment_pending: 'neutral', paid: 'warning', in_progress: 'warning', delivered: 'success', cancelled: 'danger',
}

const NEXT_STATUS: Record<RequestStatus, RequestStatus | null> = {
  requested: null, payment_pending: null, paid: 'in_progress', in_progress: 'delivered', delivered: null, cancelled: null,
}

export function AdminRequestsPage() {
  const { showToast } = useToast()
  const [requests, setRequests] = useState<AutomationRequestWithAutomation[]>([])
  const [loading, setLoading] = useState(true)
  const [notesByRequest, setNotesByRequest] = useState<Record<string, string>>({})

  async function refresh() {
    setRequests(await listAllRequests())
    setLoading(false)
  }

  useEffect(() => {
    refresh()
  }, [])

  async function advance(request: AutomationRequestWithAutomation) {
    const nextStatus = NEXT_STATUS[request.status]
    if (!nextStatus) return
    await updateRequestStatus(request.id, nextStatus, notesByRequest[request.id])
    showToast(`Request marked ${nextStatus}`)
    await refresh()
  }

  if (loading) return <p>Loading requests...</p>
  if (requests.length === 0) return <p>No requests yet.</p>

  return (
    <div>
      {requests.map((request) => {
        const nextStatus = NEXT_STATUS[request.status]
        return (
          <Card key={request.id} className="my-requests-card">
            <h3>{request.automation.name}</h3>
            <Badge tone={STATUS_TONE[request.status]}>{request.status}</Badge>
            {nextStatus === 'delivered' && (
              <Input
                label="Delivery notes"
                value={notesByRequest[request.id] ?? ''}
                onChange={(e) => setNotesByRequest({ ...notesByRequest, [request.id]: e.target.value })}
              />
            )}
            {nextStatus && <Button onClick={() => advance(request)}>Mark {nextStatus}</Button>}
          </Card>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `npx vitest run src/pages/admin/AdminRequestsPage.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 10: Commit**

```bash
git add src/pages/admin/AdminRequestsPage.tsx
git commit -m "feat: add admin request management page"
```

- [ ] **Step 11: Wire the route and nav link**

Modify `src/App.tsx` — add the import `import { AdminRequestsPage } from './pages/admin/AdminRequestsPage'` and update the admin `ProtectedRoute` block to:
```tsx
<Route element={<ProtectedRoute requireRole="admin" />}>
  <Route path="/admin/automations" element={<AdminCatalogPage />} />
  <Route path="/admin/requests" element={<AdminRequestsPage />} />
</Route>
```

Modify `src/components/layout/AppLayout.tsx` — update the admin-only nav links:
```tsx
{profile?.role === 'admin' && (
  <>
    <Link to="/admin/automations">Admin Catalog</Link>
    <Link to="/admin/requests">Admin Requests</Link>
  </>
)}
```

- [ ] **Step 12: Verify build and lint are clean**

Run: `npm run build && npm run lint`
Expected: both exit 0.

- [ ] **Step 13: Commit**

```bash
git add src/App.tsx src/components/layout/AppLayout.tsx
git commit -m "feat: route admin requests page and link it from the nav"
```

Follow the **End-of-task procedure** from Workflow & Skills now.

---

## Task 8: Golden-Path Playwright E2E Test

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/golden-path.spec.ts`
- Modify: `package.json` (add `test:e2e` script)
- Create: `.env.e2e.example` (documents the env vars the test reads)

**Interfaces:**
- Consumes: the running app from Tasks 1–7 (no new app code) plus a manually-seeded Supabase project and Stripe test-mode keys (see preconditions below).

**Preconditions (manual, one-time, before running this test):**
1. `supabase start` (or a linked hosted project) with all migrations from Task 1 applied.
2. `stripe listen --forward-to <project-ref>.functions.supabase.co/stripe-webhook` (or the local equivalent from Task 4) running so `checkout.session.completed` reaches the webhook during the test.
3. Exactly one active automation seeded via the Admin Catalog page (Task 6) or directly in SQL — its `name` must match `E2E_AUTOMATION_NAME`.
4. One user signed up through the app, then promoted to admin directly in SQL: `update profiles set role = 'admin' where email = '<admin email>';`
5. `STRIPE_SECRET_KEY`/`VITE_STRIPE_PUBLISHABLE_KEY` are Stripe **test-mode** keys (`sk_test_…` / `pk_test_…`) — never run this against live keys.

### Steps

- [ ] **Step 1: Document the required env vars**

Create `.env.e2e.example`:
```
E2E_ADMIN_EMAIL=
E2E_ADMIN_PASSWORD=
E2E_AUTOMATION_NAME=Invoice Sync
```

- [ ] **Step 2: Add the Playwright config**

Create `playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
```

Add to `package.json` scripts:
```json
"test:e2e": "playwright test"
```

- [ ] **Step 3: Write the golden-path test**

Check current selectors against https://docs.stripe.com/testing before relying on the card-form field labels below — Stripe's hosted Checkout markup has changed field labeling across releases.

Create `tests/e2e/golden-path.spec.ts`:
```ts
import { test, expect } from '@playwright/test'

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL!
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD!
const AUTOMATION_NAME = process.env.E2E_AUTOMATION_NAME ?? 'Invoice Sync'

test('customer requests and pays for an automation, admin delivers it', async ({ page, browser }) => {
  const customerEmail = `e2e-${Date.now()}@example.com`

  await page.goto('/')
  await page.getByText(AUTOMATION_NAME).click()

  await page.getByRole('button', { name: 'Log in / Sign up' }).click()
  await page.getByText('Need an account? Sign up').click()
  await page.getByLabel('Company name').fill('E2E Test Co')
  await page.getByLabel('Email').fill(customerEmail)
  await page.getByLabel('Password').fill('e2e-test-password-123')
  await page.getByRole('button', { name: 'Sign up' }).click()

  await page.getByRole('button', { name: 'Request this automation' }).click()
  await page.waitForURL(/checkout\.stripe\.com/)

  await page.getByLabel('Email').fill(customerEmail)
  await page.getByPlaceholder('1234 1234 1234 1234').fill('4242424242424242')
  await page.getByPlaceholder('MM / YY').fill('12/34')
  await page.getByPlaceholder('CVC').fill('123')
  await page.getByLabel('Cardholder name').fill('E2E Test')
  await page.getByRole('button', { name: /Pay/ }).click()

  await page.waitForURL(/\/checkout\/result\?status=success/)
  await expect(page.getByText('Payment received')).toBeVisible()

  await page.goto('/my-requests')
  await expect(page.getByText('paid')).toBeVisible({ timeout: 30_000 })

  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await adminPage.goto('/')
  await adminPage.getByRole('button', { name: 'Log in / Sign up' }).click()
  await adminPage.getByLabel('Email').fill(ADMIN_EMAIL)
  await adminPage.getByLabel('Password').fill(ADMIN_PASSWORD)
  await adminPage.getByRole('button', { name: 'Log in' }).click()

  await adminPage.goto('/admin/requests')
  await adminPage.getByRole('button', { name: 'Mark in_progress' }).click()
  await expect(adminPage.getByRole('button', { name: 'Mark delivered' })).toBeVisible()
  await adminPage.getByLabel('Delivery notes').fill('Connected to your Gmail and HubSpot.')
  await adminPage.getByRole('button', { name: 'Mark delivered' }).click()
  await adminContext.close()

  await page.goto('/my-requests')
  await expect(page.getByText('delivered')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Connected to your Gmail and HubSpot.')).toBeVisible()
})
```

- [ ] **Step 4: Run it against the seeded environment**

Run: `npx playwright test`
Expected: 1 passed. If it fails at the Stripe Checkout step, re-verify the field selectors against current Stripe Checkout markup (Step 3 note); if it fails waiting for `'paid'`, confirm `stripe listen` (or the deployed webhook) is actually forwarding events.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts tests/e2e/golden-path.spec.ts package.json .env.e2e.example
git commit -m "test: add golden-path e2e test covering browse-to-delivery"
```

Follow the **End-of-task procedure** from Workflow & Skills now. This is the last task.
