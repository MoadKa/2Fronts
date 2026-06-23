import { supabase } from '../lib/supabaseClient'
import type { Automation } from '../types/database'

export interface NewAutomationInput {
  name: string
  summary: string
  outcome_description: string
  category: string
  price_cents: number
  currency?: string
  // Which connector fulfils this automation. Without it the DB default
  // ('twilio_missed_call') applies, so a Google Sheets / Slack automation could
  // never be created from the Admin UI. Admin sets it explicitly.
  connector_type: string
  // Twilio missed-call needs a booking link at request time; other connectors
  // do not. Drives the booking-link field on the customer detail page.
  requires_provisioning?: boolean
  // Admin can create an automation inactive (hidden from the catalog) and flip
  // it live later — e.g. Slack stays inactive until its OAuth secrets are set.
  is_active?: boolean
}

export async function listActiveAutomations(): Promise<Automation[]> {
  const { data, error } = await supabase
    .from('automations')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as Automation[]) ?? []
}

export async function getAutomationById(id: string): Promise<Automation | null> {
  const { data, error } = await supabase.from('automations').select('*').eq('id', id).single()
  if (error) return null
  return data as Automation
}

export async function listAllAutomations(): Promise<Automation[]> {
  const { data, error } = await supabase.from('automations').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return (data as Automation[]) ?? []
}

export async function createAutomation(input: NewAutomationInput): Promise<Automation> {
  const { data, error } = await supabase
    .from('automations')
    .insert({ ...input, currency: input.currency ?? 'eur' })
    .select()
    .single()
  if (error) throw error
  return data as Automation
}

export async function updateAutomation(
  id: string,
  patch: Partial<NewAutomationInput> & { is_active?: boolean }
): Promise<Automation> {
  const { data, error } = await supabase.from('automations').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data as Automation
}
