import { useEffect, useMemo, useState, type SVGProps } from 'react'
import { Link } from 'react-router-dom'
import { listActiveAutomations } from '../../services/AutomationService'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Reveal } from '../../components/ui/Reveal'
import type { Automation } from '../../types/database'
import './CatalogPage.css'

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
}

type IconProps = SVGProps<SVGSVGElement>

function ShieldCheckIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  )
}

function LockIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15.5" r="1.25" />
    </svg>
  )
}

function SparkleIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3l1.6 4.9L18.5 9.5l-4.9 1.6L12 16l-1.6-4.9-4.9-1.6 4.9-1.6L12 3z" />
      <path d="M19 16l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1z" />
    </svg>
  )
}

function SearchIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.5-4.5" />
    </svg>
  )
}

function CardIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 14.5h4" />
    </svg>
  )
}

function RocketIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3c2.5 1.2 4 4 4 8 0 2-1 4-1 4H9s-1-2-1-4c0-4 1.5-6.8 4-8z" />
      <path d="M9 15l-2.5 2.5M15 15l2.5 2.5M9.5 19h5" />
      <circle cx="12" cy="9" r="1.25" />
    </svg>
  )
}

export function CatalogPage() {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [activeCategory, setActiveCategory] = useState('')

  useEffect(() => {
    // A rejected fetch (network blip, a deploy in flight) must degrade to an
    // error state, not hang on the spinner forever. `finally` guarantees the
    // loading flag clears on both success and failure.
    listActiveAutomations()
      .then((data) => setAutomations(data))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [])

  const categories = useMemo(() => {
    const unique = new Set(automations.map((automation) => automation.category))
    return Array.from(unique).sort((a, b) => a.localeCompare(b))
  }, [automations])

  const filteredAutomations = useMemo(() => {
    if (!activeCategory) return automations
    return automations.filter((automation) => automation.category === activeCategory)
  }, [automations, activeCategory])

  return (
    <div className="landing">
      <section className="hero">
        <div className="hero-blobs" aria-hidden="true">
          <span className="blob blob-1" />
          <span className="blob blob-2" />
          <span className="blob blob-3" />
        </div>
        <div className="hero-content">
          <span className="hero-eyebrow">Automation marketplace for busy teams</span>
          <h1>Skip the build. Buy the outcome.</h1>
          <p className="hero-sub">
            Browse ready-made automations built by specialists, pay securely, and get them delivered straight
            into your stack — no scoping calls, no guesswork.
          </p>
          <div className="hero-actions">
            <a href="#catalog" className="btn btn-primary">
              Browse automations
            </a>
            <a href="#how-it-works" className="hero-link">
              See how it works ↓
            </a>
          </div>
        </div>
      </section>

      <Reveal>
        <section className="trust-strip">
          <div className="trust-item">
            <span className="trust-icon">
              <ShieldCheckIcon />
            </span>
            <h3>Outcome-based delivery</h3>
            <p>You pay for a working result, not billable hours or vague promises.</p>
          </div>
          <div className="trust-item">
            <span className="trust-icon">
              <LockIcon />
            </span>
            <h3>Secured by Stripe checkout</h3>
            <p>Every purchase runs through encrypted, PCI-compliant payment processing.</p>
          </div>
          <div className="trust-item">
            <span className="trust-icon">
              <SparkleIcon />
            </span>
            <h3>Built by automation specialists</h3>
            <p>Each listing is designed and tested by people who build automations for a living.</p>
          </div>
        </section>
      </Reveal>

      <section id="how-it-works" className="steps-section">
        <Reveal>
          <h2>How it works</h2>
        </Reveal>
        <div className="steps-grid">
          <Reveal delay={0}>
            <div className="step-card">
              <span className="step-number">1</span>
              <span className="trust-icon">
                <SearchIcon />
              </span>
              <h3>Find the right automation</h3>
              <p>Browse by category and outcome until you find the automation that matches your workflow.</p>
            </div>
          </Reveal>
          <Reveal delay={80}>
            <div className="step-card">
              <span className="step-number">2</span>
              <span className="trust-icon">
                <CardIcon />
              </span>
              <h3>Request it and pay securely</h3>
              <p>Submit a request and check out through Stripe — no calls, no back-and-forth on scope.</p>
            </div>
          </Reveal>
          <Reveal delay={160}>
            <div className="step-card">
              <span className="step-number">3</span>
              <span className="trust-icon">
                <RocketIcon />
              </span>
              <h3>Get it delivered and tracked</h3>
              <p>We build and deliver it to your stack, with progress visible anytime in My Requests.</p>
            </div>
          </Reveal>
        </div>
      </section>

      <section id="catalog" className="catalog-section">
        <div className="page-header">
          <h2>Browse automations</h2>
          <p>Ready-to-run automations from our catalog, delivered to your team.</p>
        </div>

        {categories.length >= 2 && (
          <div className="category-chips">
            <button
              type="button"
              className={activeCategory === '' ? 'chip chip-active' : 'chip'}
              onClick={() => setActiveCategory('')}
            >
              All
            </button>
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className={activeCategory === category ? 'chip chip-active' : 'chip'}
                onClick={() => setActiveCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>
        )}

        {loading && <p>Loading catalog...</p>}
        {!loading && loadError && (
          <div className="empty-state">
            <p>Der Katalog konnte gerade nicht geladen werden. Bitte lade die Seite neu.</p>
          </div>
        )}
        {!loading && !loadError && automations.length === 0 && (
          <div className="empty-state">
            <p>No automations available yet.</p>
          </div>
        )}

        {!loading && !loadError && automations.length > 0 && (
          <>
            {filteredAutomations.length === 0 ? (
              <div className="catalog-grid">
                <p>No automations in this category yet.</p>
              </div>
            ) : (
              <div className="catalog-grid">
                {filteredAutomations.map((automation, index) => (
                  <Reveal key={automation.id} delay={index * 40}>
                    <Link to={`/automations/${automation.id}`} className="catalog-card-link">
                      <Card>
                        <Badge>{automation.category}</Badge>
                        <h3>{automation.name}</h3>
                        <p>{automation.summary}</p>
                        <strong>{formatPrice(automation.price_cents, automation.currency)}</strong>
                      </Card>
                    </Link>
                  </Reveal>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <Reveal>
        <section className="final-cta">
          <h2>Ready to put your busywork on autopilot?</h2>
          <p>Browse the catalog and find an automation that pays for itself in the first week.</p>
          <a href="#catalog" className="btn btn-primary">
            Browse automations
          </a>
        </section>
      </Reveal>
    </div>
  )
}
