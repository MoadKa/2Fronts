import { supabase } from '../lib/supabaseClient'

// A Slack channel the lead-notification connector can post to. Shape mirrors the
// `slack-configure` action 'list' response: { channels: [{ id, name }] }.
export interface SlackChannel {
  id: string
  name: string
}

// Map a raw edge-function error code to a customer-friendly message KEY under
// slackConnect.errors.*. The page resolves the key with i18n; keeping codes out
// of the UI means the customer never sees a raw code or stack.
function mapSlackErrorKey(code: string): string {
  if (code.includes('no_connection') || code.includes('token') || code === 'forbidden') {
    return 'slackConnect.errors.connection'
  }
  if (code.includes('missing_scope') || code.includes('not_allowed')) {
    return 'slackConnect.errors.permission'
  }
  return 'slackConnect.errors.generic'
}

async function readSlackErrorKey(error: unknown): Promise<string> {
  // A FunctionsHttpError carries the Response on `.context`; the error code lives
  // in its JSON body. Fall back to the error message, then to a generic key.
  const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = (await ctx.json()) as { error?: string }
      if (body?.error) return mapSlackErrorKey(body.error)
    } catch {
      // ignore — fall through to the message
    }
  }
  const msg = (error as { message?: string }).message
  return msg ? mapSlackErrorKey(msg) : mapSlackErrorKey('')
}

/**
 * Read the connector_type of a provision so the /connect/:id/confirm screen can
 * branch (google_sheets -> mapping UI, slack_notifications -> channel picker).
 * Returns null when the provision (or its automation's connector_type) can't be
 * read. The provision derives its type from the automation at purchase time.
 */
export async function getProvisionConnectorType(provisionId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('automation_provisions')
    .select('connector_type')
    .eq('id', provisionId)
    .single()
  if (error) return null
  const type = (data as { connector_type?: string } | null)?.connector_type
  return type ?? null
}

/**
 * List the Slack channels the customer's connected workspace exposes, by calling
 * the `slack-configure` edge function (action 'list'). The function pulls a live
 * Slack token from the stored connection and runs conversations.list server-side.
 * Throws an Error whose message is an i18n key (slackConnect.errors.*).
 */
export async function listSlackChannels(provisionId: string): Promise<SlackChannel[]> {
  const { data, error } = await supabase.functions.invoke('slack-configure', {
    body: { provisionId, action: 'list' },
  })
  if (error) throw new Error(await readSlackErrorKey(error))
  const channels = (data as { channels?: SlackChannel[] } | null)?.channels
  return channels ?? []
}

/**
 * Persist the customer's chosen channel onto the provision (config.channelId) via
 * the `slack-configure` edge function (action 'confirm'), which writes through the
 * admin client (RLS blocks the browser) and advances the provision so fulfilment
 * can proceed. Throws an Error whose message is an i18n key on failure.
 */
export async function confirmSlackChannel(
  provisionId: string,
  channelId: string,
  channelName: string | null,
): Promise<void> {
  const { error } = await supabase.functions.invoke('slack-configure', {
    body: { provisionId, action: 'confirm', channelId, channelName },
  })
  if (error) throw new Error(await readSlackErrorKey(error))
}
