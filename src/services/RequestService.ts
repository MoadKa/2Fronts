import { supabase } from '../lib/supabaseClient'
import type { AutomationRequest, AutomationRequestWithAutomation, RequestStatus } from '../types/database'

export async function createRequest(automationId: string): Promise<AutomationRequest> {
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) throw new Error('Must be signed in to request an automation')

  const { data, error } = await supabase
    .from('automation_requests')
    .insert({ automation_id: automationId, customer_id: userId })
    .select()
    .single()
  if (error) throw error
  return data as AutomationRequest
}

// Create the provision row for a paid request. Its connector_type DERIVES from
// the purchased automation (passed in) instead of defaulting to the Twilio
// missed-call product — that is what makes Sheets, Slack, and Twilio all
// purchasable. The Twilio-only business details (name / booking link) are only
// written for the missed-call connector; other connectors carry their settings
// in `config`, populated later at connect/confirm time.
export async function createProvisionDetails(
  requestId: string,
  connectorType: string,
  details?: { businessName?: string; bookingLink?: string; businessHours?: string }
): Promise<void> {
  const row: Record<string, unknown> = {
    request_id: requestId,
    connector_type: connectorType,
    status: 'pending',
  }
  if (connectorType === 'twilio_missed_call') {
    row.business_name = details?.businessName ?? ''
    row.booking_link = details?.bookingLink ?? ''
    row.business_hours = details?.businessHours ?? null
  }
  const { error } = await supabase.from('automation_provisions').insert(row)
  if (error) throw error
}

export async function createCheckoutSession(requestId: string): Promise<{ url: string }> {
  const { data, error } = await supabase.functions.invoke('create-checkout-session', {
    body: { requestId },
  })
  if (error) throw error
  return data as { url: string }
}

const REQUEST_WITH_AUTOMATION_SELECT = '*, automation:automations(*), automation_provisions(*)'

// automation_provisions.request_id is UNIQUE, so PostgREST treats the embed as a
// to-ONE relationship and returns it as a single object (or null), NOT an array.
// The UI treats it as an array (request.automation_provisions[0]), so without
// this an embedded provision was silently dropped -> no provision panel, no
// concierge setup button. Normalize object|null -> array so every consumer sees
// the same shape. (Unit tests mock it as an array, which is why this never
// surfaced before live.)
export function normalizeProvisions<T extends { automation_provisions?: unknown }>(row: T): T {
  const p = (row as { automation_provisions?: unknown }).automation_provisions
  return { ...row, automation_provisions: Array.isArray(p) ? p : p ? [p] : [] }
}

export async function listMyRequests(): Promise<AutomationRequestWithAutomation[]> {
  const { data, error } = await supabase
    .from('automation_requests')
    .select(REQUEST_WITH_AUTOMATION_SELECT)
    .order('requested_at', { ascending: false })
  if (error) throw error
  return ((data as AutomationRequestWithAutomation[]) ?? []).map(normalizeProvisions)
}

export async function listAllRequests(filter?: { status?: RequestStatus }): Promise<AutomationRequestWithAutomation[]> {
  let query = supabase
    .from('automation_requests')
    .select(REQUEST_WITH_AUTOMATION_SELECT)
    .order('requested_at', { ascending: false })
  if (filter?.status) {
    query = query.eq('status', filter.status)
  }
  const { data, error } = await query
  if (error) throw error
  return ((data as AutomationRequestWithAutomation[]) ?? []).map(normalizeProvisions)
}

export async function retryProvisioning(requestId: string): Promise<{ status: string }> {
  const { data, error } = await supabase.functions.invoke('retry-provision', {
    body: { requestId },
  })
  if (error) throw error
  return data as { status: string }
}

export async function updateRequestStatus(
  id: string,
  status: RequestStatus,
  deliveryNotes?: string
): Promise<AutomationRequest> {
  const patch: Partial<AutomationRequest> = { status }
  if (deliveryNotes !== undefined) patch.delivery_notes = deliveryNotes
  if (status === 'delivered') patch.delivered_at = new Date().toISOString()

  const { data, error } = await supabase.from('automation_requests').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data as AutomationRequest
}
