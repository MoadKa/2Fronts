import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildConsentNotice,
  buildConsentSubmission,
  CONSENT_NOTICE_VERSION,
} from './consent'

const DENO_COPY = resolve(__dirname, '../../supabase/functions/_shared/consent.ts')

describe('consent wording', () => {
  // -------------------------------------------------------------------------
  // THE MIRROR TEST
  //
  // src/lib/consent.ts and supabase/functions/_shared/consent.ts are hand-kept
  // copies (a Vite module and a Deno module cannot share source). If they drift,
  // the server stores a record of a screen the visitor never saw, and the
  // consent is worthless at exactly the moment someone challenges it.
  //
  // This reads the Deno file as TEXT rather than importing it, so it works
  // regardless of runtime. Both files write their templates with the same `${b}`
  // placeholder, so substituting it reproduces what the edge function renders.
  // -------------------------------------------------------------------------
  it('renders byte-identical strings to the Deno copy, in both locales', () => {
    const denoSource = readFileSync(DENO_COPY, 'utf8')
    const mirrored = denoSource.replace(/\$\{b\}/g, 'Coach Meyer')

    for (const locale of ['de', 'en'] as const) {
      const built = buildConsentNotice(CONSENT_NOTICE_VERSION, locale, 'Coach Meyer')
      expect(built, `no notice built for ${locale}`).not.toBeNull()
      expect(
        mirrored,
        `the ${locale} LABEL in src/lib/consent.ts is not present in the Deno copy`,
      ).toContain(built!.label)
      expect(
        mirrored,
        `the ${locale} NOTICE in src/lib/consent.ts is not present in the Deno copy`,
      ).toContain(built!.notice)
    }
  })

  it('shares the version identifier with the Deno copy', () => {
    const denoSource = readFileSync(DENO_COPY, 'utf8')
    expect(denoSource).toContain(`CONSENT_NOTICE_VERSION = '${CONSENT_NOTICE_VERSION}'`)
  })

  // Same literals as the Deno-side wording lock. Duplicated on purpose: this is
  // what makes editing the text a two-file, two-test decision instead of a typo.
  it('locks the German label and notice character for character', () => {
    const built = buildConsentNotice(CONSENT_NOTICE_VERSION, 'de', 'Coach Meyer')!
    expect(built.label).toBe(
      'Ja, Coach Meyer darf mir zu diesem Gespräch eine E-Mail schreiben, auch wenn ich heute keinen Termin buche.',
    )
    expect(built.notice).toBe(
      'Wir schicken dir gleich eine kurze Bestätigungsmail. Erst wenn du darin auf den Link klickst, gilt die Einwilligung. Sie gilt nur für Coach Meyer und nur für E-Mail, es geht ausschließlich um dieses Gespräch, eine einzige E-Mail, kein Newsletter, keine Weitergabe an Dritte. Du kannst jederzeit widerrufen, mit einem Klick am Ende der E-Mail. Der Versand läuft technisch über 2Fronts (2fronts.de) im Auftrag von Coach Meyer. Deine Einwilligung speichern wir mit Zeitpunkt drei Jahre lang, um sie belegen zu können, mehr dazu in der Datenschutzerklärung. Ohne Häkchen kannst du hier ganz normal weiterschreiben und einen Termin buchen.',
    )
  })

  it('locks the English label and notice character for character', () => {
    const built = buildConsentNotice(CONSENT_NOTICE_VERSION, 'en', 'Coach Meyer')!
    expect(built.label).toBe(
      'Yes, Coach Meyer may email me about this conversation, even if I do not book an appointment today.',
    )
    expect(built.notice).toBe(
      'We will send you a short confirmation email in a moment. Your consent only counts once you click the link in it. It applies to Coach Meyer only and to email only, it covers this conversation and nothing else, a single email, no newsletter, no sharing with third parties. You can withdraw at any time, with one click at the bottom of that email. The sending runs technically through 2Fronts (2fronts.de) on behalf of Coach Meyer. We store your consent with a timestamp for three years so we can prove it, more on this in the privacy policy. Without the tick you can carry on chatting here and book an appointment as normal.',
    )
  })

  it('contains no em or en dash in the German strings', () => {
    const built = buildConsentNotice(CONSENT_NOTICE_VERSION, 'de', 'Coach Meyer')!
    expect(built.notice).not.toContain('—')
    expect(built.notice).not.toContain('–')
    expect(built.label).not.toContain('—')
    expect(built.label).not.toContain('–')
  })
})

describe('buildConsentNotice', () => {
  it('returns null for an unknown version', () => {
    expect(buildConsentNotice('concierge-followup-email-v2', 'de', 'Coach Meyer')).toBeNull()
  })

  // The realistic case: the intro probe has not resolved yet, so businessName is
  // still null. The page must render NO checkbox rather than one naming nobody.
  it('returns null while the business name is still unknown', () => {
    expect(buildConsentNotice(CONSENT_NOTICE_VERSION, 'de', null)).toBeNull()
    expect(buildConsentNotice(CONSENT_NOTICE_VERSION, 'de', undefined)).toBeNull()
    expect(buildConsentNotice(CONSENT_NOTICE_VERSION, 'de', '   ')).toBeNull()
  })

  it('returns null for an implausibly long business name', () => {
    expect(buildConsentNotice(CONSENT_NOTICE_VERSION, 'de', 'x'.repeat(201))).toBeNull()
  })

  it('trims the name it renders', () => {
    const built = buildConsentNotice(CONSENT_NOTICE_VERSION, 'de', '  Coach Meyer  ')!
    expect(built.rendered_business_name).toBe('Coach Meyer')
  })
})

describe('buildConsentSubmission', () => {
  const notice = buildConsentNotice(CONSENT_NOTICE_VERSION, 'de', 'Coach Meyer')

  it('builds the claim the server will re-check when the box is ticked', () => {
    expect(buildConsentSubmission(true, notice)).toEqual({
      notice_version: CONSENT_NOTICE_VERSION,
      locale: 'de',
      rendered_business_name: 'Coach Meyer',
    })
  })

  it('sends nothing when the box is unticked', () => {
    expect(buildConsentSubmission(false, notice)).toBeNull()
  })

  // An unrendered notice and an unticked box must be indistinguishable on the
  // wire: both mean "no consent", and neither may produce a stored row.
  it('sends nothing when the notice could not be rendered', () => {
    expect(buildConsentSubmission(true, null)).toBeNull()
  })
})
