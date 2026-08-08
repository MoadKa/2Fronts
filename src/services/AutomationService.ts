import { supabase } from '../lib/supabaseClient'
import type { Automation, AutomationTranslations } from '../types/database'

export interface NewAutomationInput {
  name: string
  summary: string
  outcome_description: string
  // Per-locale overrides (e.g. { en: { name, summary, outcome_description } }).
  // Base fields above stay the primary language (German).
  translations?: AutomationTranslations
  category: string
  price_cents: number
  currency?: string
  // Billing model. 'subscription' bills recurring (needs recurring_interval, e.g.
  // 'month'); 'one_time' is a single payment (recurring_interval must be null).
  // Defaults to one_time at the DB level when omitted.
  pricing_model?: 'one_time' | 'subscription'
  recurring_interval?: 'day' | 'week' | 'month' | 'year' | null
  // Which connector fulfils this automation. Mandatory: the column's DB default
  // was 'twilio_missed_call' until that product was retired on 2026-08-07, and
  // migration 20260807160000 dropped it, so omitting this is now a NOT NULL
  // violation rather than a silent (and wrong) default.
  connector_type: string
  // Whether purchase creates an automation_provisions row that fulfillment then
  // has to act on. No connector collects settings on the customer detail page
  // any more; the booking-link field that used to depend on this belonged to the
  // retired Twilio connector.
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
