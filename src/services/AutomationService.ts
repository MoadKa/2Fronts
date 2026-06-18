import { supabase } from '../lib/supabaseClient'
import type { Automation } from '../types/database'

export interface NewAutomationInput {
  name: string
  summary: string
  outcome_description: string
  category: string
  price_cents: number
  currency?: string
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
