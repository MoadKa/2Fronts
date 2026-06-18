import { supabase } from '../lib/supabaseClient'
import type { AutomationRequest, AutomationRequestWithAutomation } from '../types/database'

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
