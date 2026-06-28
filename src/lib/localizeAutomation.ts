import type { Automation } from '../types/database'

// Catalog content (name, summary, outcome_description) lives in the DB, so it is
// not covered by the i18n JSON files. The base columns are the primary language
// (German); `translations[lang]` holds human-authored overrides per locale.
// This picks the override for the active language and falls back to the base
// column field-by-field, so a partial translation never blanks a card.
type LocalizableAutomation = Pick<
  Automation,
  'name' | 'summary' | 'outcome_description' | 'translations'
>

export interface LocalizedAutomationFields {
  name: string
  summary: string
  outcome_description: string
}

export function localizeAutomation(
  automation: LocalizableAutomation,
  language: string | undefined,
): LocalizedAutomationFields {
  // Normalise e.g. "en-US" -> "en". German is the base language: for it (or any
  // unknown code) we use the base columns directly.
  const code = (language || 'de').slice(0, 2).toLowerCase()
  const override = code !== 'de' ? automation.translations?.[code] : undefined
  return {
    name: override?.name?.trim() || automation.name,
    summary: override?.summary?.trim() || automation.summary,
    outcome_description: override?.outcome_description?.trim() || automation.outcome_description,
  }
}
