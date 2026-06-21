import { assertThrows, assertExists } from 'jsr:@std/assert@1'
import { createAdminClient } from './supabaseAdmin.ts'

Deno.test('createAdminClient throws when SUPABASE_URL is missing', () => {
  Deno.env.delete('SUPABASE_URL')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
  assertThrows(
    () => createAdminClient(),
    Error,
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables'
  )
})

Deno.test('createAdminClient throws when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
  Deno.env.set('SUPABASE_URL', 'https://example.supabase.co')
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY')
  assertThrows(
    () => createAdminClient(),
    Error,
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables'
  )
})

Deno.test('createAdminClient returns a working client when env vars are present', () => {
  Deno.env.set('SUPABASE_URL', 'https://example.supabase.co')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
  const client = createAdminClient()
  assertExists(client.auth)
  assertExists(client.from)
})
