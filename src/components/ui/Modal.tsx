import { useEffect, useRef, type ReactNode } from 'react'
import './Modal.css'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  /**
   * Accessible name. Every caller already renders a heading as the first thing
   * inside; pass the same text so the dialog announces itself as that thing
   * rather than as an unnamed group.
   */
  label?: string
  children: ReactNode
}

export function Modal({ isOpen, onClose, label, children }: ModalProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  // Callers pass an inline arrow, so a new identity arrives on every render.
  // Holding it in a ref keeps the trap effect keyed on `isOpen` alone —
  // otherwise it re-ran mid-typing and yanked focus back to the first field.
  // Assigned in an effect rather than during render: writing a ref while
  // rendering is a side effect React is allowed to discard.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Without this the overlay was decorative: nothing announced a dialog, Escape
  // did nothing, and Tab walked straight out into the page behind the scrim.
  useEffect(() => {
    if (!isOpen) return
    const content = contentRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null
    const items = () => Array.from(content?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    ;(items()[0] ?? content)?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !content) return
      const focusable = items()
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === content)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      // Send the caret back where the visitor left it, not to the top of the page.
      previouslyFocused?.focus()
    }
  }, [isOpen])

  if (!isOpen) return null
  return (
    <div className="modal-overlay" data-testid="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        ref={contentRef}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
