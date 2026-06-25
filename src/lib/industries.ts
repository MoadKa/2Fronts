// Shared industry (Branche) taxonomy. Used by the catalog "what's missing?"
// request form (industry dropdown) and offered as default options for the
// concierge wizard's "industry" qualification criterion. Stable `value` for
// storage/analytics; `de`/`en` labels for display.

export interface Industry {
  value: string
  de: string
  en: string
}

export const INDUSTRIES: Industry[] = [
  { value: 'coaching', de: 'Coaching & Beratung', en: 'Coaching & Consulting' },
  { value: 'health', de: 'Gesundheit & Wellness', en: 'Health & Wellness' },
  { value: 'fitness', de: 'Fitness & Sport', en: 'Fitness & Sports' },
  { value: 'realestate', de: 'Immobilien', en: 'Real Estate' },
  { value: 'finance', de: 'Finanzen & Versicherung', en: 'Finance & Insurance' },
  { value: 'legal', de: 'Recht & Steuern', en: 'Legal & Tax' },
  { value: 'agency', de: 'Agentur & Marketing', en: 'Agency & Marketing' },
  { value: 'ecommerce', de: 'E-Commerce & Handel', en: 'E-commerce & Retail' },
  { value: 'software', de: 'Software & IT', en: 'Software & IT' },
  { value: 'education', de: 'Bildung & Kurse', en: 'Education & Courses' },
  { value: 'trades', de: 'Handwerk & Bau', en: 'Trades & Construction' },
  { value: 'hospitality', de: 'Gastronomie & Hotellerie', en: 'Hospitality & Food' },
  { value: 'other', de: 'Sonstiges', en: 'Other' },
]

export function industryLabel(value: string, lang: string): string {
  const found = INDUSTRIES.find((i) => i.value === value)
  if (!found) return value
  return lang.startsWith('en') ? found.en : found.de
}
