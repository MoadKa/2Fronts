import { useEffect, useMemo, useState, type SVGProps } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { listActiveAutomations } from '../../services/AutomationService'
import { localizeAutomation, localizeCategory } from '../../lib/localizeAutomation'
import { LiveSetter, type LiveSetterStatus } from './LiveSetter'
import { CatalogRequestSection } from './CatalogRequestSection'
import { useDocumentMeta } from '../../hooks/useDocumentMeta'
import type { Automation } from '../../types/database'
import './CatalogPage.css'

// The home page is a walk through a small exhibition. Three Rousseau paintings
// hang on an oxblood wall; between them the visitor steps onto a linen floor
// where the product's own business is done. The paintings are real, public
// domain, and downloaded into public/art — nothing here is a stock render.
//
// The rhythm is wall, floor, wall, floor: look at something, then read
// something. That alternation IS the pacing; do not collapse it into cards.

const SITE = 'https://2fronts.de'
// The three URLs that render this component. /automations is a legacy alias
// kept for existing links (see route comment in App.tsx) and canonicals to
// the homepage rather than self-referencing, so it doesn't compete with it as
// duplicate content. /en is the dedicated, indexable English entry point
// (seo-audit-2026-07-08.md finding #3 — previously there was no crawlable
// English content at all, since language was a client-side-only toggle).
const DE_TITLE = '2Fronts — AI Appointment Setter für Coaches & Berater'
const DE_DESCRIPTION =
  'Dein KI-Appointment-Setter für 200 €/Monat: beantwortet Anfragen auf deiner Seite aus deinen eigenen Inhalten und bucht qualifizierte Erstgespräche direkt in deinen Kalender.'

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
}

// React 18 passes an unknown camelCase `fetchPriority` straight to the DOM and
// warns; the attribute itself is lowercase in HTML. Spread it instead.
const HERO_PRIORITY = { fetchpriority: 'high' } as Record<string, string>

type IconProps = SVGProps<SVGSVGElement>

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

// One hung work with its wall label. The label carries the real catalogue facts
// first (artist, title, year, medium, collection, rights) and only then our own
// reading of it — the order a museum uses, and the order that keeps our line
// from posing as part of the artwork's record.
// How a work is hung. A gallery does not centre everything at one size forever:
//   split        — full-bleed half image, half text, edge to edge
//   facing       — canvas and wall text side by side inside the room
//   split-mirror — the same split, flipped, so the walk never repeats itself
type Hang = 'split' | 'facing' | 'split-mirror'

function Work({
  src,
  alt,
  title,
  meta,
  note,
  width,
  height,
  hang,
  eager,
}: {
  src: string
  alt: string
  title: string
  meta: string
  note: string
  width: number
  height: number
  hang: Hang
  eager?: boolean
}) {
  const { t } = useTranslation()
  return (
    <figure className={`dg-work dg-work--${hang}`}>
      <img
        className="dg-canvas"
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
      />
      <figcaption className="dg-label">
        <span className="dg-label-artist">{t('home.artist')}</span>
        <span className="dg-label-title">{title}</span>
        <span className="dg-label-meta">
          {meta} · {t('home.publicDomain')}
        </span>
        <p className="dg-label-note">{note}</p>
      </figcaption>
    </figure>
  )
}

// The exhibit in the display case: the night as it actually happened, on the
// device it actually happened on. Built in CSS and SVG rather than a photo or a
// mockup image — it stays sharp at any density, weighs nothing, and the content
// is real text a crawler and a screen reader can read.
//
// Rounded corners are the one deliberate exception to this world's zero-radius
// rule. A phone is a physical object in a vitrine, like a painting in a frame;
// the rule governs the interface, not the artefacts it displays.
function PhoneThread() {
  const { t } = useTranslation()
  return (
    <div className="dg-phone">
      <div className="dg-phone-screen">
        <span className="dg-phone-island" aria-hidden="true" />
        <div className="dg-phone-status" aria-hidden="true">
          <span className="dg-time">{t('home.clock')}</span>
          <span className="dg-phone-icons">
            <svg viewBox="0 0 24 12" width="26" height="13" fill="currentColor" aria-hidden="true">
              <rect x="0" y="4" width="3" height="8" rx="1" />
              <rect x="5" y="2" width="3" height="10" rx="1" />
              <rect x="10" y="0" width="3" height="12" rx="1" />
              <rect x="16" y="1" width="7" height="11" rx="2" opacity="0.55" />
            </svg>
          </span>
        </div>

        <div className="dg-phone-head">
          <span className="dg-phone-title">{t('home.threadTitle')}</span>
          <span className="dg-phone-sub">{t('home.threadFrom')}</span>
        </div>

        <div className="dg-phone-thread">
          <div className="dg-bubble dg-bubble--in">
            <p>{t('home.msgBody')}</p>
            <span className="dg-bubble-time dg-time">{t('home.clock')}</span>
          </div>

          <div className="dg-bubble dg-bubble--out">
            <p>{t('home.reply')}</p>
            <span className="dg-bubble-time dg-time">{t('home.replyTime')}</span>
          </div>

          <div className="dg-phone-booked">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7" />
            </svg>
            <span>{t('home.bookedLabel')}</span>
            <span className="dg-time">{t('home.bookedWhen')}</span>
          </div>
        </div>
      </div>
    </div>
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
  const [setterStatus, setSetterStatus] = useState<LiveSetterStatus>('probing')

  // /en is a dedicated English entry point regardless of the visitor's stored
  // language preference — that's the whole point of it being a stable,
  // indexable URL. i18n's own localStorage cache then carries English into
  // the rest of the session as they browse from here.
  useEffect(() => {
    if (isEnglishRoute && i18n.language !== 'en') i18n.changeLanguage('en')
  }, [isEnglishRoute, i18n])

  useDocumentMeta({
    title: isEnglishRoute ? `${t('home.head')} — 2Fronts` : DE_TITLE,
    description: isEnglishRoute ? t('home.sub') : DE_DESCRIPTION,
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

  const primary = automations.length > 0 ? automations[0]! : null

  // The offer room already shows `primary` with its real price. The catalog
  // room lists what else the marketplace holds, and those prices are not
  // decided yet. Leaving `primary` in the list would print "Preis noch offen"
  // for the one product whose price the page states two rooms earlier.
  const rest = useMemo(
    () => (primary ? automations.filter((automation) => automation.id !== primary.id) : automations),
    [automations, primary],
  )

  const categories = useMemo(() => {
    const unique = new Set(rest.map((automation) => automation.category))
    return Array.from(unique).sort((a, b) => a.localeCompare(b))
  }, [rest])

  const filteredAutomations = useMemo(() => {
    if (!activeCategory) return rest
    return rest.filter((automation) => automation.category === activeCategory)
  }, [rest, activeCategory])

  const buyHref = primary ? `/automations/${primary.id}` : '#angebot'

  return (
    <div className="dg-page dg-museum">
      {/* ── Entrance. The panel by the door: what the show is, and the ticket. */}
      <section className="dg-entrance">
        {/* The whole hero is one painting. It fills the opening the way a mural
            does, so it is cropped to the viewport: an environment you walk
            into, not an exhibit. The works in the rooms below are never
            cropped, they are hung whole with their labels. */}
        {/* The mural is the LCP image. A phone was downloading the full 1.2MB
            plate to cover a 390px-wide viewport; the 960px variant is 311KB. */}
        <img
          className="dg-hero-image"
          src="/art/rousseau-surprised.jpg"
          srcSet="/art/rousseau-surprised-900.jpg 960w, /art/rousseau-surprised.jpg 1920w"
          sizes="100vw"
          alt={t('home.work0Alt')}
          width={1920}
          height={1534}
          {...HERO_PRIORITY}
        />
        {/* Type over a painting is unreadable without one. The scrim is heavy
            where the words are and clears completely on the far side. */}
        <div className="dg-hero-scrim" aria-hidden="true" />

        <div className="dg-entrance-inner">
          <div className="dg-entrance-copy">
            <h1>{t('home.head')}</h1>
            {/* The five-second answer. The headline is a hook, not a
                description; a cold visitor still has to learn what this is. */}
            <p className="dg-entrance-sub">{t('home.heroWhat')}</p>
            <div className="dg-cta-block">
              <Link to={buyHref} className="dg-cta">
                {t('home.ctaTrial')}
                <ArrowRightIcon className="dg-cta-icon" aria-hidden="true" />
              </Link>
              <span className="dg-cta-note">{t('home.ctaNote')}</span>
            </div>
            {/* The page's only external evidence. It was welded to the payment
                terms in one muted block, which read as legal small print; a
                borrowed figure has to be legible to be worth borrowing. */}
            <p className="dg-hero-evidence">
              {t('home.heroEvidence')}
              <span className="dg-hero-evidence-source">{t('home.heroEvidenceSource')}</span>
            </p>
          </div>
        </div>

        {/* Still credited, even where the painting is being used as a wall
            rather than shown as a work. */}
        <p className="dg-hero-credit">
          {t('home.artist')}, <i>{t('home.work0Title')}</i> · {t('home.work0Meta')} ·{' '}
          {t('home.publicDomain')}
        </p>
      </section>

      {/* ── Room I. A diptych in a black room: the painting on the left, the
             condition report on the right. She sleeps, the lion does nothing,
             and beside it the same night is measured in hours. The painting
             carries the feeling, the measure carries the proof; neither works
             alone, which is why the bare timeline read as weak. */}
      <section className="dg-room dg-room--black dg-room--gap">
        <span className="dg-room-no" aria-hidden="true">I</span>
        <div className="dg-shell dg-diptych">
          <figure className="dg-night-work">
            <img
              className="dg-canvas"
              src="/art/rousseau-sleeping-gypsy.jpg"
              alt={t('home.work1Alt')}
              width={1920}
              height={1227}
              loading="lazy"
              decoding="async"
            />
            <figcaption className="dg-label">
              <span className="dg-label-artist">{t('home.artist')}</span>
              <span className="dg-label-title">{t('home.work1Title')}</span>
              <span className="dg-label-meta">
                {t('home.work1Meta')} · {t('home.publicDomain')}
              </span>
              <p className="dg-label-note">{t('home.work1Note')}</p>
            </figcaption>
          </figure>

          <div className="dg-report">
            <h2>{t('home.gapTitle')}</h2>
            <p className="dg-gap-body">{t('home.gapBody')}</p>

            {/* A vertical scale, read top to bottom like the night itself. */}
            <div className="dg-gap" role="img" aria-label={t('home.gapAria')}>
              <div className="dg-gap-point">
                <span className="dg-time">{t('home.clock')}</span>
                <span className="dg-gap-mark-label">{t('home.gapStart')}</span>
              </div>
              <div className="dg-gap-run">
                <span className="dg-gap-span">{t('home.gapSpan')}</span>
              </div>
              <div className="dg-gap-point">
                <span className="dg-time">08:34</span>
                <span className="dg-gap-mark-label">{t('home.gapEnd')}</span>
              </div>
            </div>

            <p className="dg-gap-stat">
              {t('home.gapStat')}
              <span className="dg-gap-source">{t('home.gapStatSource')}</span>
            </p>
          </div>
        </div>
      </section>

      {/* ── The vitrine: the same night as a document, not a painting. */}
      <section className="dg-room dg-room--floor">
        <span className="dg-room-no" aria-hidden="true">II</span>
        <div className="dg-shell">
          {/* The display case: the object on one side, its label on the other. */}
          <div className="dg-vitrine">
            <PhoneThread />
            <div className="dg-vitrine-label">
              {/* The room's own heading. A 0.95rem caption was doing a
                  heading's job, which is why this stop read as an orphan. */}
              <h2>{t('home.vitrineTitle')}</h2>
              <p className="dg-vitrine-note">{t('home.phoneCaption')}</p>
              <p className="dg-synthetic">{t('home.exampleNote')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Room II. The one exhibit you may touch. */}
      <section id="live" className="dg-room dg-room--floor">
        <span className="dg-room-no" aria-hidden="true">III</span>
        <div className="dg-shell">
          <div className="dg-live-head">
            <h2>{t('home.liveTitle')}</h2>
            <p className="dg-touch">{t('home.touchLabel')}</p>
            <p className="dg-live-sub">
              {setterStatus === 'down' ? t('home.liveSubDown') : t('home.liveSub')}
            </p>
          </div>
          <div className="dg-setter">
            <LiveSetter onStatus={setSetterStatus} />
            <div className="dg-setter-aside">
              <div className="dg-fact">
                <b>{t('home.fact1Title')}</b>
                <span>{t('home.fact1Body')}</span>
              </div>
              <div className="dg-fact">
                <b>{t('home.fact2Title')}</b>
                <span>{t('home.fact2Body')}</span>
              </div>
              <div className="dg-fact">
                <b>{t('home.fact3Title')}</b>
                <span>{t('home.fact3Body')}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Room III. What grows without you. */}
      <section className="dg-room dg-room--wall">
        <span className="dg-room-no" aria-hidden="true">IV</span>
        <Work
          src="/art/rousseau-equatorial-jungle.jpg"
          alt={t('home.work2Alt')}
          title={t('home.work2Title')}
          meta={t('home.work2Meta')}
          note={t('home.work2Note')}
          width={1280}
          height={1391}
          hang="facing"
        />
      </section>

      {/* ── The setup, in three steps, on the floor. */}
      <section id="so-gehts" className="dg-room dg-room--floor">
        <span className="dg-room-no" aria-hidden="true">V</span>
        <div className="dg-shell">
          <div className="dg-room-head">
            <h2>{t('home.whatTitle')}</h2>
            <p className="dg-what-sub">{t('home.whatSub')}</p>
          </div>
          <div className="dg-what-grid">
            <ol className="dg-steps">
              <li>
                <div>
                  <b>{t('home.step1Title')}</b>
                  <span>{t('home.step1Body')}</span>
                </div>
              </li>
              <li>
                <div>
                  <b>{t('home.step2Title')}</b>
                  <span>{t('home.step2Body')}</span>
                </div>
              </li>
              <li>
                <div>
                  <b>{t('home.step3Title')}</b>
                  <span>{t('home.step3Body')}</span>
                </div>
              </li>
            </ol>
          </div>
        </div>
      </section>

      {/* ── One price, on its plinth. */}
      <section id="angebot" className="dg-room dg-room--floor dg-room--peak">
        <span className="dg-room-no" aria-hidden="true">VI</span>
        <div className="dg-shell">
          <div className="dg-room-head">
            <h2>{t('home.offerTitle')}</h2>
            <p className="dg-what-sub">{t('home.offerLead')}</p>
          </div>

          {loading && <p className="dg-note">{t('catalog.loadingCatalog')}</p>}
          {!loading && !primary && (
            <div className="dg-note">
              <p>{loadError ? t('catalog.loadError') : t('catalog.emptyCatalog')}</p>
              <p>{t('home.offerUnavailable')}</p>
            </div>
          )}

          {primary && (
            <Link to={`/automations/${primary.id}`} className="dg-offer-card">
              <div className="dg-offer-main">
                <h3>{localizeAutomation(primary, i18n.language).name}</h3>
                <p className="dg-offer-summary">{localizeAutomation(primary, i18n.language).summary}</p>
                <ul className="dg-offer-bullets">
                  {[1, 2, 3].map((n) => (
                    <li key={n}>
                      <CheckIcon className="dg-tick" aria-hidden="true" />
                      {t(`offer.bullet${n}`)}
                    </li>
                  ))}
                </ul>
                {/* Catalogue metadata, below the work, never above the heading. */}
                <p className="dg-offer-cat">{localizeCategory(primary.category, t)}</p>
              </div>
              <div className="dg-offer-buy">
                <span className="dg-price">
                  {formatPrice(primary.price_cents, primary.currency)}
                  {primary.pricing_model === 'subscription' && <small> {t('catalog.perMonth')}</small>}
                </span>
                {/* With no customers, no testimonials and no case study, the
                    offer's own terms are the entire trust budget of this page.
                    The 30-day guarantee is real and documented in
                    public/pricing.md.
                    (The founding-price scarcity line stays off this page: it is
                    a scarcity claim from a company with no customers, and the
                    founder pinned 200 EUR as the one number shown here.) */}
                {/* Gated on subscription: the trial, the monthly cancellation
                    and the 30-day guarantee are terms of the subscription. On a
                    one-time product they would be claims about an offer that
                    does not exist. */}
                {primary.pricing_model === 'subscription' && (
                  <ul className="dg-risk">
                    <li>{t('home.riskTrial')}</li>
                    <li>{t('home.riskCard')}</li>
                    <li>{t('home.riskCancel')}</li>
                    <li>{t('home.riskGuarantee')}</li>
                  </ul>
                )}
                <span className="dg-offer-note">{t('offer.note')}</span>
                <span className="dg-cta">
                  {t('offer.cta')}
                  <ArrowRightIcon className="dg-cta-icon" aria-hidden="true" />
                </span>
              </div>
            </Link>
          )}
        </div>
      </section>

      {/* ── The rest of the collection, mentioned quietly. */}
      <section id="katalog" className="dg-room dg-room--floor">
        <span className="dg-room-no" aria-hidden="true">VII</span>
        <div className="dg-shell">
          <div className="dg-room-head">
            <h2>{t('home.horizonTitle')}</h2>
            <p className="dg-horizon-sub">{t('home.horizonSub')}</p>
            <p className="dg-horizon-sub">{t('home.horizonBody')}</p>
          </div>

          {automations.length > 1 && (
            <>
              {categories.length >= 2 && (
                <div className="dg-chips">
                  <button
                    type="button"
                    className={activeCategory === '' ? 'dg-chip dg-chip-active' : 'dg-chip'}
                    onClick={() => setActiveCategory('')}
                  >
                    {t('catalog.filterAll')}
                  </button>
                  {categories.map((category) => (
                    <button
                      key={category}
                      type="button"
                      className={activeCategory === category ? 'dg-chip dg-chip-active' : 'dg-chip'}
                      onClick={() => setActiveCategory(category)}
                    >
                      {localizeCategory(category, t)}
                    </button>
                  ))}
                </div>
              )}

              {filteredAutomations.length === 0 ? (
                <p className="dg-note">{t('catalog.emptyCategory')}</p>
              ) : (
                <div className="dg-list">
                  {filteredAutomations.map((automation) => {
                    const loc = localizeAutomation(automation, i18n.language)
                    return (
                      <Link key={automation.id} to={`/automations/${automation.id}`} className="dg-row">
                        <span>
                          <b>{loc.name}</b>
                          <span>{loc.summary}</span>
                        </span>
                        {/* Only the setter's price is decided. Printing a
                            formatted euro figure for an automation the founder
                            has not priced would publish a number nobody chose. */}
                        <span className="dg-row-price">{t('home.priceHidden')}</span>
                      </Link>
                    )
                  })}
                </div>
              )}
            </>
          )}
          {/* The wish form belongs to this room: it is how the collection
              grows. Left outside, the room was a heading with nothing under
              it and the form was an unlabelled block. */}
          <CatalogRequestSection />
        </div>
      </section>

      {/* ── The last room, mirrored, and the way out. */}
      <section className="dg-room dg-room--wall dg-room--split">
        <span className="dg-room-no" aria-hidden="true">VIII</span>
        <Work
          src="/art/rousseau-carnival-evening.jpg"
          alt={t('home.work3Alt')}
          title={t('home.work3Title')}
          meta={t('home.work3Meta')}
          note={t('home.work3Note')}
          width={960}
          height={1244}
          hang="split-mirror"
        />
      </section>

      <section className="dg-close">
        <div className="dg-shell">
          <div className="dg-close-inner">
            <h2>{t('home.closeTitle')}</h2>
            <p>{t('home.closeBody')}</p>
            <Link to={buyHref} className="dg-cta">
              {t('home.ctaTrial')}
              <ArrowRightIcon className="dg-cta-icon" aria-hidden="true" />
            </Link>
            <span className="dg-cta-note">{t('home.ctaNote')}</span>
          </div>
        </div>
      </section>
    </div>
  )
}
