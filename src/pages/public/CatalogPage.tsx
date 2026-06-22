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
          <span className="hero-eyebrow">Automatisierungs-Marktplatz für Teams mit wenig Zeit</span>
          <h1>Nicht selbst bauen. Das Ergebnis kaufen.</h1>
          <p className="hero-sub">
            Entdecke fertige Automatisierungen von Spezialisten, bezahle sicher und erhalte sie direkt
            in deinem System — ohne Beratungsgespräche, ohne Rätselraten.
          </p>
          <div className="hero-actions">
            <a href="#catalog" className="btn btn-primary">
              Automatisierungen entdecken
            </a>
            <a href="#how-it-works" className="hero-link">
              So funktioniert's ↓
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
            <h3>Ergebnis statt Aufwand</h3>
            <p>Du zahlst für ein funktionierendes Ergebnis — nicht für Stunden oder vage Versprechen.</p>
          </div>
          <div className="trust-item">
            <span className="trust-icon">
              <LockIcon />
            </span>
            <h3>Sichere Zahlung über Stripe</h3>
            <p>Jeder Kauf läuft über verschlüsselte, PCI-konforme Zahlungsabwicklung.</p>
          </div>
          <div className="trust-item">
            <span className="trust-icon">
              <SparkleIcon />
            </span>
            <h3>Von Spezialisten gebaut</h3>
            <p>Jede Automatisierung wird von Profis entwickelt und getestet, die das täglich machen.</p>
          </div>
        </section>
      </Reveal>

      <section id="how-it-works" className="steps-section">
        <Reveal>
          <h2>So funktioniert's</h2>
        </Reveal>
        <div className="steps-grid">
          <Reveal delay={0}>
            <div className="step-card">
              <span className="step-number">1</span>
              <span className="trust-icon">
                <SearchIcon />
              </span>
              <h3>Die passende Automatisierung finden</h3>
              <p>Stöbere nach Kategorie und Ergebnis, bis du die Automatisierung findest, die zu deinem Ablauf passt.</p>
            </div>
          </Reveal>
          <Reveal delay={80}>
            <div className="step-card">
              <span className="step-number">2</span>
              <span className="trust-icon">
                <CardIcon />
              </span>
              <h3>Anfragen und sicher bezahlen</h3>
              <p>Stelle eine Anfrage und bezahle über Stripe — ohne Anrufe, ohne langes Hin und Her.</p>
            </div>
          </Reveal>
          <Reveal delay={160}>
            <div className="step-card">
              <span className="step-number">3</span>
              <span className="trust-icon">
                <RocketIcon />
              </span>
              <h3>Geliefert und nachverfolgbar</h3>
              <p>Wir richten alles in deinem System ein — den Fortschritt siehst du jederzeit unter „Meine Anfragen".</p>
            </div>
          </Reveal>
        </div>
      </section>

      <section id="catalog" className="catalog-section">
        <div className="page-header">
          <h2>Automatisierungen entdecken</h2>
          <p>Sofort einsatzbereite Automatisierungen aus unserem Katalog, geliefert an dein Team.</p>
        </div>

        {categories.length >= 2 && (
          <div className="category-chips">
            <button
              type="button"
              className={activeCategory === '' ? 'chip chip-active' : 'chip'}
              onClick={() => setActiveCategory('')}
            >
              Alle
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

        {loading && <p>Katalog wird geladen…</p>}
        {!loading && loadError && (
          <div className="empty-state">
            <p>Der Katalog konnte gerade nicht geladen werden. Bitte lade die Seite neu.</p>
          </div>
        )}
        {!loading && !loadError && automations.length === 0 && (
          <div className="empty-state">
            <p>Noch keine Automatisierungen verfügbar.</p>
          </div>
        )}

        {!loading && !loadError && automations.length > 0 && (
          <>
            {filteredAutomations.length === 0 ? (
              <div className="catalog-grid">
                <p>In dieser Kategorie gibt es noch keine Automatisierungen.</p>
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
          <h2>Bereit, deine Routinearbeit zu automatisieren?</h2>
          <p>Durchstöbere den Katalog und finde eine Automatisierung, die sich schon in der ersten Woche bezahlt macht.</p>
          <a href="#catalog" className="btn btn-primary">
            Automatisierungen entdecken
          </a>
        </section>
      </Reveal>
    </div>
  )
}
