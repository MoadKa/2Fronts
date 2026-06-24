import { describe, it, expect } from 'vitest'
import {
  emptyWizardData,
  progressFor,
  nextStep,
  prevStep,
  isValidBookingUrl,
  slugify,
  isValidSlug,
  validateStep,
  validateAll,
  TOTAL_CONTENT_STEPS,
  type WizardData,
} from './conciergeWizard'

function fullData(over: Partial<WizardData> = {}): WizardData {
  return {
    ...emptyWizardData('de'),
    businessName: 'Acme Coaching',
    offer: 'We coach founders.',
    qa: '',
    calendarUrl: 'https://cal.com/acme',
    tone: 'friendly',
    ...over,
  }
}

describe('conciergeWizard progress', () => {
  it('reads 0 on welcome and full on done', () => {
    expect(progressFor('welcome')).toMatchObject({ current: 0, total: TOTAL_CONTENT_STEPS, ratio: 0 })
    expect(progressFor('done')).toMatchObject({ current: 5, total: 5, ratio: 1 })
  })

  it('numbers the five content steps 1..5', () => {
    expect(progressFor('business').current).toBe(1)
    expect(progressFor('offer').current).toBe(2)
    expect(progressFor('questions').current).toBe(3)
    expect(progressFor('booking').current).toBe(4)
    expect(progressFor('tone').current).toBe(5)
    expect(progressFor('tone').ratio).toBeCloseTo(1)
    expect(progressFor('questions').ratio).toBeCloseTo(0.6)
  })
})

describe('conciergeWizard navigation', () => {
  it('walks forward and back and clamps at the bookends', () => {
    expect(nextStep('welcome')).toBe('business')
    expect(nextStep('tone')).toBe('done')
    expect(nextStep('done')).toBe('done') // clamps
    expect(prevStep('business')).toBe('welcome')
    expect(prevStep('welcome')).toBe('welcome') // clamps
  })
})

describe('isValidBookingUrl', () => {
  it('accepts http(s) absolute URLs', () => {
    expect(isValidBookingUrl('https://cal.com/acme')).toBe(true)
    expect(isValidBookingUrl('http://calendly.com/acme')).toBe(true)
    expect(isValidBookingUrl('  https://cal.com/acme  ')).toBe(true)
  })

  it('rejects empty, non-url, and non-http schemes', () => {
    expect(isValidBookingUrl('')).toBe(false)
    expect(isValidBookingUrl('cal.com/acme')).toBe(false)
    expect(isValidBookingUrl('not a url')).toBe(false)
    expect(isValidBookingUrl('javascript:alert(1)')).toBe(false)
    expect(isValidBookingUrl('ftp://cal.com')).toBe(false)
  })
})

describe('slugify / isValidSlug', () => {
  it('derives a URL-safe slug from a business name', () => {
    expect(slugify('Acme Coaching')).toBe('acme-coaching')
    expect(slugify('  Müller & Söhne!  ')).toBe('muller-sohne')
    expect(slugify('Acme   ---   Co')).toBe('acme-co')
  })

  it('validates slug shape', () => {
    expect(isValidSlug('acme-coaching')).toBe(true)
    expect(isValidSlug('Acme Coaching')).toBe(false)
    expect(isValidSlug('')).toBe(false)
    expect(isValidSlug('-bad-')).toBe(false)
  })
})

describe('validateStep', () => {
  it('requires business name on the business step', () => {
    expect(validateStep('business', fullData({ businessName: '' }))).toBe('required')
    expect(validateStep('business', fullData())).toBeNull()
  })

  it('requires an offer', () => {
    expect(validateStep('offer', fullData({ offer: '' }))).toBe('required')
    expect(validateStep('offer', fullData())).toBeNull()
  })

  it('treats questions as optional', () => {
    expect(validateStep('questions', fullData({ qa: '' }))).toBeNull()
  })

  it('requires a valid booking URL', () => {
    expect(validateStep('booking', fullData({ calendarUrl: '' }))).toBe('required')
    expect(validateStep('booking', fullData({ calendarUrl: 'nope' }))).toBe('invalidUrl')
    expect(validateStep('booking', fullData())).toBeNull()
  })

  it('never blocks welcome/tone/done', () => {
    expect(validateStep('welcome', fullData())).toBeNull()
    expect(validateStep('tone', fullData())).toBeNull()
    expect(validateStep('done', fullData())).toBeNull()
  })
})

describe('validateAll', () => {
  it('passes a fully filled wizard', () => {
    expect(validateAll(fullData())).toBeNull()
  })

  it('reports the first failing field', () => {
    expect(validateAll(fullData({ businessName: '' }))).toBe('required')
    expect(validateAll(fullData({ calendarUrl: 'bad' }))).toBe('invalidUrl')
  })

  it('catches a business name that produces an unusable slug', () => {
    expect(validateAll(fullData({ businessName: '!!!' }))).toBe('slugInvalid')
  })
})

describe('language selection feeds the concierge', () => {
  it('emptyWizardData carries the chosen language through', () => {
    expect(emptyWizardData('en').language).toBe('en')
    expect(emptyWizardData('de').language).toBe('de')
  })
})
