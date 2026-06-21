import { supabase } from '../lib/supabaseClient'
import type { ConfirmedFieldMapping, ProposedMapping } from '../types/database'

// The proposed column mapping is produced by the connect/read step (T4) and
// stored on the provision row under `config.proposedMapping`. Until T4 ships,
// this reads from the same source so the screen has a single, simple origin.
interface ProvisionConfig {
  proposedMapping?: ProposedMapping
  confirmedMapping?: ConfirmedFieldMapping[]
  mappingConfirmedAt?: string
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
  const { data, error: readError } = await supabase
    .from('automation_provisions')
    .select('config')
    .eq('id', provisionId)
    .single()
  if (readError) throw readError

  const existingConfig = (data?.config ?? {}) as ProvisionConfig
  const nextConfig: ProvisionConfig = {
    ...existingConfig,
    confirmedMapping,
    mappingConfirmedAt: new Date().toISOString(),
  }

  const { error: updateError } = await supabase
    .from('automation_provisions')
    .update({ config: nextConfig, status: 'provisioning' })
    .eq('id', provisionId)
  if (updateError) throw updateError
}
