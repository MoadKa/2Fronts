import { supabase } from '../lib/supabaseClient'
import type { Connector } from '../types/database'

// Public catalog for the Supported-software page. RLS already hides non-public
// (internal) connectors like the Twilio missed-call plumbing; the explicit
// is_public filter is belt-and-suspenders so an admin viewer sees the same
// public list a logged-out visitor does. Ordered by the registry's sort_order.
export async function listPublicConnectors(): Promise<Connector[]> {
  const { data, error } = await supabase
    .from('connector_registry')
    .select('connector_type, display_name, category, status, is_public, sort_order, created_at')
    .eq('is_public', true)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data as Connector[]) ?? []
}
