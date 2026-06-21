import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export interface ProvisionAutomation {
  purchaseNumber: (businessName: string) => Promise<{ phoneNumber: string; sid: string }>
}

export type AttemptProvisionResult = 'active' | 'failed' | 'not-claimed'

// Claim-row-first: this UPDATE only succeeds (returns a row) if status still
// matches `fromStatus`. A concurrent/duplicate caller (a redelivered Stripe
// webhook, or two admins clicking "Retry" at once) finds 0 matching rows and
// gets 'not-claimed' -- it never reaches the Twilio purchase call below, so
// neither path can buy a second number for the same provision.
export async function attemptProvision(
  adminClient: SupabaseClient,
  provisionRow: { id: string; business_name: string },
  fromStatus: string,
  provisionAutomation: ProvisionAutomation
): Promise<AttemptProvisionResult> {
  const { data: claimed } = await adminClient
    .from('automation_provisions')
    .update({ status: 'provisioning' })
    .eq('status', fromStatus)
    .eq('id', provisionRow.id)
    .select()
    .maybeSingle()

  if (!claimed) return 'not-claimed'

  try {
    const { phoneNumber, sid } = await provisionAutomation.purchaseNumber(provisionRow.business_name)
    await adminClient
      .from('automation_provisions')
      .update({ status: 'active', twilio_phone_number: phoneNumber, twilio_phone_number_sid: sid })
      .eq('id', provisionRow.id)
    return 'active'
  } catch {
    await adminClient
      .from('automation_provisions')
      .update({ status: 'failed' })
      .eq('id', provisionRow.id)
    return 'failed'
  }
}
