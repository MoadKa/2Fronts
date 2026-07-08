import { useEffect, useMemo, useState, type SVGProps } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { listActiveAutomations } from '../../services/AutomationService'
import { localizeAutomation, localizeCategory } from '../../lib/localizeAutomation'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Reveal } from '../../components/ui/Reveal'
import { DemoVideo } from '../../components/ui/DemoVideo'
import { HeroNightChat } from './HeroNightChat'
import { CatalogRequestSection } from './CatalogRequestSection'
import { useDocumentMeta } from '../../hooks/useDocumentMeta'
import type { Automation } from '../../types/database'
import './CatalogPage.css'

const SITE = 'https://2fronts.de'
// The three URLs that render this component. /automations is a legacy alias
// kept for existing links (see route comment in App.tsx) and canonicals to
// the homepage rather than self-referencing, so it doesn't compete with it as
// duplicate content. /en is the dedicated, indexable English entry point
// (seo-audit-2026-07-08.md finding #3 — previously there was no crawlable
// English content at all, since language was a client-side-only toggle).
const DE_TITLE = '2Fronts — AI Appointment Setter für Coaches & Berater'
const DE_DESCRIPTION =
  'Dein KI-Appointment-Setter für 199 €/Monat: berät deine Interessenten 24/7 aus deinen eigenen Inhalten und bucht qualifizierte Erstgespräche direkt in deinen Kalender.'

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

function ArrowRightIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  )
}

function CheckIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  )
}

export function CatalogPage() {
  const { t, i18n } = useTranslation()
  const location = useLocation()
  const isEnglishRoute = location.pathname === '/en'
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [activeCategory, setActiveCategory] = useState('')

  // /en is a dedicated English entry point regardless of the visitor's stored
  // language preference — that's the whole point of it being a stable,
  // indexable URL. i18n's own localStorage cache then carries English into
  // the rest of the session as they browse from here.
  useEffect(() => {
    if (isEnglishRoute && i18n.language !== 'en') i18n.changeLanguage('en')
  }, [isEnglishRoute, i18n])

  useDocumentMeta({
    title: isEnglishRoute ? `${t('catalog.heroTitle')} — 2Fronts` : DE_TITLE,
    description: isEnglishRoute ? t('catalog.heroSub') : DE_DESCRIPTION,
    canonical: isEnglishRoute ? `${SITE}/en` : `${SITE}/`,
    hreflang: [
      { lang: 'de', href: `${SITE}/` },
      { lang: 'en', href: `${SITE}/en` },
      { lang: 'x-default', href: `${SITE}/` },
    ],
  })

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
    <div className="landing landing-nachttisch">
      <section className="night-hero bleed">
        <div className="night-glow" aria-hidden="true" />
        <div className="night-inner">
          <div className="night-copy rise-stagger">
            <span className="night-kicker">{t('nightHero.kicker')}</span>
            <h1>{t('nightHero.headline')}</h1>
            <p className="night-sub">{t('nightHero.sub')}</p>
            <div className="hero-actions night-actions">
              <a href="#demo" className="btn btn-primary hero-cta">
                {t('nightHero.cta')}
                <ArrowRightIcon className="hero-cta-icon" aria-hidden="true" />
              </a>
              <a href="#catalog" className="hero-link night-link">
                {t('catalog.discoverAutomations')}
              </a>
            </div>
          </div>
          <HeroNightChat />
        </div>
      </section>

      <div className="dawn bleed" aria-hidden="true" />

      <div className="day-stage bleed">

      <section className="calendar-pain">
        <div className="pain-inner">
          <Reveal>
            <div>
              <span className="pain-kicker">{t('calendarPain.kicker')}</span>
              <h2>{t('calendarPain.title')}</h2>
              <p className="pain-sub">{t('calendarPain.sub')}</p>
              <p className="pain-resolve">{t('calendarPain.resolve')}</p>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <div className="pain-cal">
              <div className="pain-cal-head">
                <b>{t('calendarPain.calTitle')}</b>
                <span>{t('calendarPain.calVia')}</span>
              </div>
              {[1, 2, 3].map((n) => (
                <div className="pain-slot" key={n}>
                  <span className="pain-time">{n === 1 ? '10:00' : n === 2 ? '13:00' : '15:30'}</span>
                  <div className="pain-what">
                    <b>{t(`calendarPain.slot${n}Name`)}</b>
                    <span className="pain-tag">{t(`calendarPain.slot${n}Tag`)}</span>
                  </div>
                </div>
              ))}
              <div className="pain-cal-foot">
                <span>{t('calendarPain.stat1')}</span>
                <span>{t('calendarPain.stat2')}</span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="silent-pain">
        <div className="silent-inner">
          <Reveal>
            <div>
              <span className="silent-kicker">{t('silentPain.kicker')}</span>
              <h2>{t('silentPain.title')}</h2>
              <p className="silent-sub">{t('silentPain.sub')}</p>
              <p className="silent-resolve">{t('silentPain.resolve')}</p>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <div className="silent-card">
              <div className="silent-card-head">
                <b>{t('silentPain.calTitle')}</b>
                <span>{t('silentPain.calVia')}</span>
              </div>
              {[1, 2, 3].map((n) => (
                <div className={n === 2 ? 'silent-row silent-row-hit' : 'silent-row'} key={n}>
                  <div className="silent-what">
                    <b>{t(`silentPain.slot${n}Name`)}</b>
                    <span className="silent-tag">{t(`silentPain.slot${n}Tag`)}</span>
                  </div>
                </div>
              ))}
              <div className="silent-card-foot">
                <span>{t('silentPain.stat1')}</span>
                <span>{t('silentPain.stat2')}</span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <Reveal>
        <section id="demo" className="demo-section">
          <span className="demo-eyebrow">{t('demo.eyebrow')}</span>
          <h2>{t('demo.title')}</h2>
          <p className="demo-section-sub">{t('demo.sub')}</p>
          <div className="demo-section-frame">
            <DemoVideo />
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="trust-strip">
          <div className="trust-item">
            <span className="trust-icon">
              <ShieldCheckIcon />
            </span>
            <h3>{t('catalog.trust1Title')}</h3>
            <p>{t('catalog.trust1Body')}</p>
          </div>
          <div className="trust-item">
            <span className="trust-icon">
              <LockIcon />
            </span>
            <h3>{t('catalog.trust2Title')}</h3>
            <p>{t('catalog.trust2Body')}</p>
          </div>
          <div className="trust-item">
            <span className="trust-icon">
              <SparkleIcon />
            </span>
            <h3>{t('catalog.trust3Title')}</h3>
            <p>{t('catalog.trust3Body')}</p>
          </div>
        </section>
      </Reveal>

      <section id="how-it-works" className="steps-section">
        <Reveal>
          <h2>{t('catalog.howItWorks')}</h2>
        </Reveal>
        <div className="steps-grid">
          <Reveal delay={0}>
            <div className="step-card">
              <span className="step-number">1</span>
              <span className="trust-icon">
                <SearchIcon />
              </span>
              <h3>{t('catalog.step1Title')}</h3>
              <p>{t('catalog.step1Body')}</p>
            </div>
          </Reveal>
          <Reveal delay={80}>
            <div className="step-card">
              <span className="step-number">2</span>
              <span className="trust-icon">
                <CardIcon />
              </span>
              <h3>{t('catalog.step2Title')}</h3>
              <p>{t('catalog.step2Body')}</p>
            </div>
          </Reveal>
          <Reveal delay={160}>
            <div className="step-card">
              <span className="step-number">3</span>
              <span className="trust-icon">
                <RocketIcon />
              </span>
              <h3>{t('catalog.step3Title')}</h3>
              <p>{t('catalog.step3Body')}</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* The pricing spotlight: for one beat the night returns mid-page and a
          warm cone of light falls on the offer card. The card itself is
          unchanged — the stage around it makes the visitor stop. */}
      <section id="catalog" className="catalog-section catalog-spotlight">
        <div className="page-header catalog-header">
          <h2>{t('catalog.catalogSectionTitle')}</h2>
          <p>{t('catalog.catalogSectionSub')}</p>
        </div>

        {categories.length >= 2 && (
          <div className="category-chips">
            <button
              type="button"
              className={activeCategory === '' ? 'chip chip-active' : 'chip'}
              onClick={() => setActiveCategory('')}
            >
              {t('catalog.filterAll')}
            </button>
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className={activeCategory === category ? 'chip chip-active' : 'chip'}
                onClick={() => setActiveCategory(category)}
              >
                {localizeCategory(category, t)}
              </button>
            ))}
          </div>
        )}

        {loading && <p>{t('catalog.loadingCatalog')}</p>}
        {!loading && loadError && (
          <div className="empty-state">
            <p>{t('catalog.loadError')}</p>
          </div>
        )}
        {!loading && !loadError && automations.length === 0 && (
          <div className="empty-state">
            <p>{t('catalog.emptyCatalog')}</p>
          </div>
        )}

        {/* With exactly one product, a shop grid reads as an empty shelf.
            Render it as one wide offer card instead; the grid returns
            automatically once a second automation goes live. */}
        {!loading && !loadError && automations.length === 1 && (
          <Reveal>
            <Link to={`/automations/${automations[0]!.id}`} className="offer-card-link">
              {(() => {
                const a = automations[0]!
                const loc = localizeAutomation(a, i18n.language)
                return (
                  <div className="offer-card">
                    <div className="offer-main">
                      <Badge>{localizeCategory(a.category, t)}</Badge>
                      <h3>{loc.name}</h3>
                      <p className="offer-summary">{loc.summary}</p>
                      <ul className="offer-bullets">
                        {[1, 2, 3].map((n) => (
                          <li key={n}>
                            <CheckIcon className="offer-check" aria-hidden="true" />
                            {t(`offer.bullet${n}`)}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="offer-buy">
                      <span className="offer-price">
                        {formatPrice(a.price_cents, a.currency)}
                        {a.pricing_model === 'subscription' && (
                          <span className="offer-per"> {t('catalog.perMonth')}</span>
                        )}
                      </span>
                      <span className="offer-note">{t('offer.note')}</span>
                      <span className="btn btn-primary offer-cta">
                        {t('offer.cta')}
                        <ArrowRightIcon className="hero-cta-icon" aria-hidden="true" />
                      </span>
                    </div>
                  </div>
                )
              })()}
            </Link>
          </Reveal>
        )}

        {!loading && !loadError && automations.length > 1 && (
          <>
            {filteredAutomations.length === 0 ? (
              <div className="catalog-grid">
                <p>{t('catalog.emptyCategory')}</p>
              </div>
            ) : (
              <div className="catalog-grid">
                {filteredAutomations.map((automation, index) => {
                  const loc = localizeAutomation(automation, i18n.language)
                  return (
                  <Reveal key={automation.id} delay={index * 40}>
                    <Link to={`/automations/${automation.id}`} className="catalog-card-link">
                      <Card>
                        <Badge>{localizeCategory(automation.category, t)}</Badge>
                        <h3>{loc.name}</h3>
                        <p>{loc.summary}</p>
                        <strong>
                          {formatPrice(automation.price_cents, automation.currency)}
                          {automation.pricing_model === 'subscription' && ` ${t('catalog.perMonth')}`}
                        </strong>
                      </Card>
                    </Link>
                  </Reveal>
                  )
                })}
              </div>
            )}
          </>
        )}
      </section>

      <Reveal>
        <CatalogRequestSection />
      </Reveal>

      </div>

      <div className="dusk bleed" aria-hidden="true" />

      {/* Night finale — the bookend. The page opens at 23:12 with the lost
          inquiry; it closes at 23:12 with the same moment going right. */}
      <section className="night-finale bleed">
        <div className="finale-glow" aria-hidden="true" />
        <div className="finale-inner">
          <Reveal>
            <span className="night-kicker">{t('nightFinale.kicker')}</span>
            <h2>{t('nightFinale.title')}</h2>
            <p className="finale-sub">{t('nightFinale.sub')}</p>
          </Reveal>
          <Reveal delay={120}>
            <div className="finale-booked">
              <b>
                <CheckIcon className="finale-check" aria-hidden="true" />
                {t('nightFinale.bookedTitle')}
              </b>
              <span>{t('nightFinale.bookedText')}</span>
            </div>
          </Reveal>
          <Reveal delay={200}>
            {automations.length === 1 ? (
              <Link to={`/automations/${automations[0]!.id}`} className="btn btn-primary hero-cta finale-cta">
                {t('nightFinale.cta')}
                <ArrowRightIcon className="hero-cta-icon" aria-hidden="true" />
              </Link>
            ) : (
              <a href="#catalog" className="btn btn-primary hero-cta finale-cta">
                {t('nightFinale.cta')}
                <ArrowRightIcon className="hero-cta-icon" aria-hidden="true" />
              </a>
            )}
          </Reveal>
        </div>
      </section>
    </div>
  )
}
