import { supabase } from '../lib/supabaseClient'
import type { Connector, ProposedMapping } from '../types/database'

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

// Friendly German message for an edge-function error code. Falls back to a
// generic message so the customer never sees a raw code or stack.
function mapConfigureError(code: string): string {
  if (code.includes('invalid_sheet_url')) {
    return 'Dieser Link sieht nicht wie ein Google-Sheet aus. Bitte kopiere den Link aus der Adressleiste deiner geöffneten Tabelle.'
  }
  if (code.includes('no_connection') || code.includes('token_refresh') || code === 'forbidden') {
    return 'Die Google-Verbindung ist abgelaufen. Bitte verbinde Google noch einmal und versuche es erneut.'
  }
  return 'Die Tabelle konnte nicht gelesen werden. Bitte prüfe, dass das Sheet mit deinem verbundenen Google-Konto geöffnet werden kann.'
}

async function readFunctionError(error: unknown): Promise<string> {
  // A FunctionsHttpError carries the Response on `.context`; our error code lives
  // in its JSON body. Fall back to the error message, then to a generic message.
  const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = (await ctx.json()) as { error?: string }
      if (body?.error) return mapConfigureError(body.error)
    } catch {
      // ignore — fall through to the message
    }
  }
  const msg = (error as { message?: string }).message
  return msg ? mapConfigureError(msg) : mapConfigureError('')
}

/**
 * Run first-connect configuration for a provision: send the customer's Google
 * Sheet link to the connect-configure edge function, which reads the sheet,
 * proposes a column mapping, and stores it. Returns the proposed mapping for the
 * confirmation screen. Throws a customer-friendly German message on failure.
 */
export async function configureSheet(provisionId: string, spreadsheetUrl: string): Promise<ProposedMapping> {
  const { data, error } = await supabase.functions.invoke('connect-configure', {
    body: { provisionId, spreadsheetUrl },
  })
  if (error) throw new Error(await readFunctionError(error))
  const mapping = (data as { proposedMapping?: ProposedMapping } | null)?.proposedMapping
  if (!mapping) throw new Error(mapConfigureError(''))
  return mapping
}
