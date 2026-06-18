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

export async function createCheckoutSession(requestId: string): Promise<{ url: string }> {
  const { data, error } = await supabase.functions.invoke('create-checkout-session', {
    body: { requestId },
  })
  if (error) throw error
  return data as { url: string }
}

export async function listMyRequests(): Promise<AutomationRequestWithAutomation[]> {
  const { data, error } = await supabase
    .from('automation_requests')
    .select('*, automation:automations(*)')
    .order('requested_at', { ascending: false })
  if (error) throw error
  return (data as AutomationRequestWithAutomation[]) ?? []
}

export async function listAllRequests(filter?: { status?: RequestStatus }): Promise<AutomationRequestWithAutomation[]> {
  let query = supabase
    .from('automation_requests')
    .select('*, automation:automations(*)')
    .order('requested_at', { ascending: false })
  if (filter?.status) {
    query = query.eq('status', filter.status)
  }
  const { data, error } = await query
  if (error) throw error
  return (data as AutomationRequestWithAutomation[]) ?? []
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
