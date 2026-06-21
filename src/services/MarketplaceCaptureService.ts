import { supabase } from '../lib/supabaseClient'

export interface MarketplaceCapturePayload {
  email: string
  businessName: string
  automationOfInterest?: string
}

export async function submitMarketplaceCapture(payload: MarketplaceCapturePayload): Promise<void> {
  const { error } = await supabase.functions.invoke('marketplace-test-capture', {
    body: {
      email: payload.email,
      business_name: payload.businessName,
      automation_of_interest: payload.automationOfInterest,
    },
  })
  if (error) throw error
}
