// Pure logic for the Apple-style concierge onboarding wizard (#26). Kept free of
// React so the rules — step order, progress math, per-step validation, the
// booking-URL check, and slug derivation — are unit-tested in isolation and
// reused by the page component. No i18n here: these return validity + a STABLE
// error KEY the component resolves, mirroring the rest of the codebase.

import type { ConciergeLanguage } from '../../services/ConciergeService'
import type { QualCriterion } from '../../lib/qualification'

// The wizard's content steps, in order. 'welcome' and 'done' are screens, not
// content steps, so they are NOT part of the progress count ("Step 3 of 6").
export const WIZARD_STEPS = [
  'welcome',
  'business',
  'offer',
  'questions',
  'booking',
  'qualify',
  'tone',
  'done',
] as const

export type WizardStep = (typeof WIZARD_STEPS)[number]

// The numbered content steps the progress bar counts. Welcome/done bookend
// the flow but never show "Step X of 6".
export const CONTENT_STEPS: WizardStep[] = [
  'business',
  'offer',
  'questions',
  'booking',
  'qualify',
  'tone',
]
export const TOTAL_CONTENT_STEPS = CONTENT_STEPS.length

export type TonePreset = 'friendly' | 'professional' | 'casual'
export const TONE_PRESETS: TonePreset[] = ['friendly', 'professional', 'casual']

// Everything the coach enters across the wizard. Mirrors CreateConciergeInput
// (minus slug, which we derive from the business name) plus the language the
// welcome screen sets.
export interface WizardData {
  language: ConciergeLanguage
  businessName: string
  offer: string
  qa: string
  calendarUrl: string
  tone: TonePreset
  qualificationCriteria: QualCriterion[]
}

export function emptyWizardData(language: ConciergeLanguage): WizardData {
  return {
    language,
    businessName: '',
    offer: '',
    qa: '',
    calendarUrl: '',
    tone: 'friendly',
    qualificationCriteria: [],
  }
}

// Progress for the numbered steps. Welcome -> 0 (bar empty), the five content
// steps -> 1..5, done -> 5 (bar full). `current` is 0 on welcome so the bar
// reads "not started", and the label only renders for content steps.
export interface WizardProgress {
  current: number // 0 on welcome, 1..5 on content steps, 5 on done
  total: number
  ratio: number // 0..1 for the bar fill
}

export function progressFor(step: WizardStep): WizardProgress {
  const idx = CONTENT_STEPS.indexOf(step)
  let current: number
  if (step === 'welcome') current = 0
  else if (step === 'done') current = TOTAL_CONTENT_STEPS
  else current = idx + 1 // content steps are 1-indexed
  return {
    current,
    total: TOTAL_CONTENT_STEPS,
    ratio: current / TOTAL_CONTENT_STEPS,
  }
}

// Step navigation. nextStep/prevStep walk WIZARD_STEPS and clamp at the ends, so
// the component never has to special-case the welcome/done bookends.
export function nextStep(step: WizardStep): WizardStep {
  const i = WIZARD_STEPS.indexOf(step)
  return WIZARD_STEPS[Math.min(i + 1, WIZARD_STEPS.length - 1)]
}

export function prevStep(step: WizardStep): WizardStep {
  const i = WIZARD_STEPS.indexOf(step)
  return WIZARD_STEPS[Math.max(i - 1, 0)]
}

// A booking URL is valid when it parses as an absolute http(s) URL. We accept
// any host (Calendly, Cal.com, or a coach's own scheduler) but reject anything
// that isn't a real web link, so the public CTA never points at junk.
export function isValidBookingUrl(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  let url: URL
  try {
    url = new URL(v)
  } catch {
    return false
  }
  return url.protocol === 'http:' || url.protocol === 'https:'
}

// Slugs become a public URL segment, so keep them URL-safe and predictable.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// Derive a public slug from the business name so the coach never types one.
// Lowercase, spaces/punctuation -> single dashes, trimmed. The wizard owns the
// slug end-to-end; a clash is still caught server-side (conciergeSetup.slugTaken).
export function slugify(businessName: string): string {
  return businessName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents (combining diacritical marks)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug)
}

// Per-step validation. Returns an error KEY (under conciergeOnboarding.errors.*)
// or null when the step is satisfied. Welcome/done/questions have no required
// field — questions is intentionally optional (the AI degrades gracefully).
export function validateStep(step: WizardStep, data: WizardData): string | null {
  switch (step) {
    case 'business':
      return data.businessName.trim() ? null : 'required'
    case 'offer':
      return data.offer.trim() ? null : 'required'
    case 'booking':
      if (!data.calendarUrl.trim()) return 'required'
      return isValidBookingUrl(data.calendarUrl) ? null : 'invalidUrl'
    default:
      return null
  }
}

// ---- Follow-up sender identity (optional, offered AFTER the wizard) --------
//
// Not a wizard step, and deliberately so. The product promises setup in under
// 120 seconds; a seventh screen about Impressum and Datenschutz would tax every
// coach for a feature most of them will not switch on today. So this lives on
// the "you're live" screen, collapsed, and skipping it costs nothing but the
// follow-up mail itself.
//
// These rules mirror parseFollowupSender in supabase/functions/concierge-setup.
// The server re-validates everything; this copy exists only so the coach sees
// the problem next to the field instead of as a failed request.
export interface FollowupSenderData {
  senderBlock: string // legal name + summonable address, §5 DDG
  privacyUrl: string // the coach's own privacy notice, Art. 13 DSGVO
  replyTo: string // a mailbox the coach reads, §7 Abs. 2 Nr. 4 UWG
}

export function emptyFollowupSender(): FollowupSenderData {
  return { senderBlock: '', privacyUrl: '', replyTo: '' }
}

export const FOLLOWUP_SENDER_BLOCK_MAX = 500
export const FOLLOWUP_REPLY_TO_MAX = 320

// Deliberately loose, and identical to the server's: one @, no whitespace, a dot
// in the domain. A stricter pattern starts rejecting valid addresses, and the
// real proof that this mailbox is the coach's is the verification round-trip,
// not a regex.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// All four or nothing: the three fields AND the acknowledgement. A footer with a
// name but no privacy link is not partially compliant, it is a non-compliant
// mail that looks finished. Returns an error KEY under
// conciergeOnboarding.followup.errors.*, or null when it is ready to save.
export function validateFollowupSender(data: FollowupSenderData, acknowledged: boolean): string | null {
  if (!data.senderBlock.trim()) return 'senderRequired'
  if (data.senderBlock.trim().length > FOLLOWUP_SENDER_BLOCK_MAX) return 'senderTooLong'
  if (!data.privacyUrl.trim()) return 'privacyRequired'
  if (!isValidBookingUrl(data.privacyUrl)) return 'invalidUrl'
  if (!data.replyTo.trim()) return 'replyToRequired'
  if (data.replyTo.trim().length > FOLLOWUP_REPLY_TO_MAX) return 'invalidEmail'
  if (!EMAIL_RE.test(data.replyTo.trim())) return 'invalidEmail'
  if (!acknowledged) return 'ackRequired'
  return null
}

// Final gate before creating the concierge: all required content is present and
// valid, and the derived slug is usable. Returns the first failing field's key
// or null when the wizard is ready to submit.
export function validateAll(data: WizardData): string | null {
  for (const step of CONTENT_STEPS) {
    const err = validateStep(step, data)
    if (err) return err
  }
  if (!isValidSlug(slugify(data.businessName))) return 'slugInvalid'
  return null
}
