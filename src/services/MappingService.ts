import { supabase } from '../lib/supabaseClient'
import type { ConfirmedFieldMapping, ProposedMapping } from '../types/database'

// The proposed column mapping is produced by the connect/read step (T4) and
// stored on the provision row under `config.proposedMapping`. Until T4 ships,
// this reads from the same source so the screen has a single, simple origin.
interface ProvisionConfig {
  proposedMapping?: ProposedMapping
  // The human-confirmed field->column map the Sheets connector's run() files
  // against. MUST stay named `columnMapping` — that is the exact key
  // googleSheetsConnector.run() reads from the provision config.
  columnMapping?: ConfirmedFieldMapping[]
  mappingConfirmedAt?: string
  spreadsheetId?: string
  [key: string]: unknown
}

/**
 * Fetch the AI-proposed field-to-column mapping for a provision.
 * Returns null when the provision (or its proposed mapping) cannot be found.
 */
export async function getProposedMapping(provisionId: string): Promise<ProposedMapping | null> {
  const { data, error } = await supabase
    .from('automation_provisions')
    .select('config')
    .eq('id', provisionId)
    .single()
  if (error) return null
  const config = (data?.config ?? null) as ProvisionConfig | null
  return config?.proposedMapping ?? null
}

/**
 * Persist the customer's confirmed column choices back onto the provision's
 * jsonb config and advance the provision to 'provisioning' so fulfillment can
 * proceed. We merge into the existing config rather than overwriting it so the
 * original proposed mapping is preserved for auditing.
 */
export async function saveConfirmedMapping(
  provisionId: string,
  confirmedMapping: ConfirmedFieldMapping[]
): Promise<void> {
  // Writes to automation_provisions are server-side only (RLS allows admin
  // updates, not the customer's browser). Route through the confirm-mapping edge
  // function, which verifies ownership and writes config.columnMapping + status
  // via the admin client. A direct client UPDATE here is silently dropped by RLS
  // — the bug that left every confirmed lead unfilable.
  const { error } = await supabase.functions.invoke('confirm-mapping', {
    body: { provisionId, columnMapping: confirmedMapping },
  })
  if (error) throw error
}
