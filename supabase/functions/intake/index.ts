import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

interface IntakeDeps {
  createAdminClient: () => SupabaseClient
}

const defaultDeps: IntakeDeps = {
  createAdminClient,
}

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function handleIntake(req: Request, deps: IntakeDeps = defaultDeps): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  // Optional shared-secret gate. When INTAKE_SECRET is configured, require a
  // matching x-intake-secret header; otherwise the endpoint is open (TODO below).
  const expectedSecret = Deno.env.get('INTAKE_SECRET')
  if (expectedSecret && req.headers.get('x-intake-secret') !== expectedSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: jsonHeaders })
  }

  if (!isPlainObject(body)) {
    return new Response(JSON.stringify({ error: 'Body must be a JSON object' }), { status: 400, headers: jsonHeaders })
  }

  const { customer_id, automation_id, source, payload } = body as {
    customer_id?: unknown
    automation_id?: unknown
    source?: unknown
    payload?: unknown
  }

  if (typeof customer_id !== 'string' || customer_id.trim() === '') {
    return new Response(JSON.stringify({ error: 'customer_id is required' }), { status: 400, headers: jsonHeaders })
  }

  // payload must be a non-empty JSON object of captured lead fields.
  if (!isPlainObject(payload) || Object.keys(payload).length === 0) {
    return new Response(JSON.stringify({ error: 'payload is required' }), { status: 400, headers: jsonHeaders })
  }

  const row = {
    customer_id,
    automation_id: typeof automation_id === 'string' && automation_id.trim() !== '' ? automation_id : null,
    source: typeof source === 'string' && source.trim() !== '' ? source : 'api',
    payload,
    status: 'received',
  }

  try {
    const adminClient = deps.createAdminClient()
    const { data, error } = await adminClient
      .from('leads')
      .insert(row)
      .select('id')
      .single()

    if (error) {
      console.error('intake: failed to insert lead', error)
      return new Response(JSON.stringify({ error: 'Failed to record lead' }), { status: 500, headers: jsonHeaders })
    }

    const id = (data as { id?: unknown } | null)?.id
    return new Response(JSON.stringify({ received: true, id }), { status: 200, headers: jsonHeaders })
  } catch (err) {
    console.error('intake: unexpected error', err instanceof Error ? err.message : err)
    return new Response(JSON.stringify({ error: 'Failed to record lead' }), { status: 500, headers: jsonHeaders })
  }
}

if (import.meta.main) {
  Deno.serve((req) => handleIntake(req))
}
