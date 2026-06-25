import { supabase } from '../lib/supabaseClient'

export interface WishPayload {
  email: string
  // Free-text "what are you missing?" from the catalog request form.
  message?: string
  // The selected industry (Branche).
  industry?: string
  locale?: string
  // Explicit marketing opt-in (DSGVO active checkbox).
  marketingConsent?: boolean
}

export interface WishResult {
  ok: true
}

export async function submitWish(payload: WishPayload): Promise<WishResult> {
  const { error } = await supabase.functions.invoke('submit-wish', {
    body: {
      email: payload.email,
      message: payload.message,
      industry: payload.industry,
      locale: payload.locale,
      marketing_consent: payload.marketingConsent,
    },
  })
  if (error) throw error
  return { ok: true }
}
