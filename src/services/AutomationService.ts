import { supabase } from '../lib/supabaseClient'
import type { Automation } from '../types/database'

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
