import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('supabaseClient', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('throws when VITE_SUPABASE_URL is missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    await expect(import('./supabaseClient')).rejects.toThrow(
      'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables'
    )
  })

  it('creates a client when env vars are present', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    const { supabase } = await import('./supabaseClient')
    expect(supabase.auth).toBeDefined()
  })
})
