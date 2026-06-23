import { supabase } from '../lib/supabaseClient'

export interface WaitlistSignupPayload {
  email: string
  locale?: string
  source?: string
}

export interface WaitlistSignupResult {
  // True when the email was already on the list — the caller surfaces a friendly
  // "you're already subscribed" instead of a fresh "thanks".
  alreadySubscribed: boolean
}

export async function submitWaitlistSignup(payload: WaitlistSignupPayload): Promise<WaitlistSignupResult> {
  const { data, error } = await supabase.functions.invoke('waitlist-signup', {
    body: {
      email: payload.email,
      locale: payload.locale,
      source: payload.source,
    },
  })
  if (error) throw error
  return { alreadySubscribed: Boolean((data as { alreadySubscribed?: boolean } | null)?.alreadySubscribed) }
}
