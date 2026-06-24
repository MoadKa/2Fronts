import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  sendConciergeMessage,
  createConcierge,
  linkProvisionToConcierge,
  newSessionId,
} from './ConciergeService'

let invokeResult: { data: unknown; error: unknown } = { data: null, error: null }
let insertResult: { data: unknown; error: unknown } = { data: null, error: null }
let userResult: { data: { user: { id: string } | null } } = { data: { user: { id: 'user-1' } } }
let capturedInvoke: { name: string; body: unknown } | null = null
let capturedInsert: { table: string; row: Record<string, unknown> } | null = null

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve(userResult) },
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        capturedInsert = { table, row }
        return {
          select: () => ({ single: () => Promise.resolve(insertResult) }),
        }
      },
    }),
    functions: {
      invoke: (name: string, opts: { body: unknown }) => {
        capturedInvoke = { name, body: opts.body }
        return Promise.resolve(invokeResult)
      },
    },
  },
}))

describe('ConciergeService', () => {
  beforeEach(() => {
    invokeResult = { data: null, error: null }
    insertResult = { data: null, error: null }
    userResult = { data: { user: { id: 'user-1' } } }
    capturedInvoke = null
    capturedInsert = null
  })

  it('newSessionId returns a non-empty, unique-ish id', () => {
    const a = newSessionId()
    const b = newSessionId()
    expect(a.length).toBeGreaterThan(0)
    expect(a).not.toBe(b)
  })

  it('sendConciergeMessage invokes concierge-chat with slug, session and message', async () => {
    invokeResult = { data: { reply: 'Hi!', show_booking: false }, error: null }
    const result = await sendConciergeMessage('acme', 'sess-1', 'Hallo')
    expect(capturedInvoke?.name).toBe('concierge-chat')
    expect(capturedInvoke?.body).toEqual({ slug: 'acme', session_id: 'sess-1', message: 'Hallo' })
    expect(result).toEqual({ reply: 'Hi!', show_booking: false })
  })

  it('sendConciergeMessage returns the booking link when show_booking is true', async () => {
    invokeResult = { data: { reply: 'Book here', show_booking: true, calendar_url: 'https://cal.com/x' }, error: null }
    const result = await sendConciergeMessage('acme', 'sess-1', 'I want to book')
    expect(result.show_booking).toBe(true)
    expect(result.calendar_url).toBe('https://cal.com/x')
  })

  it('sendConciergeMessage throws conciergeChat.unavailable when the slug is not found', async () => {
    invokeResult = {
      data: null,
      error: { context: { json: () => Promise.resolve({ error: 'not_found' }) } },
    }
    await expect(sendConciergeMessage('nope', 'sess-1', 'hi')).rejects.toThrow('conciergeChat.unavailable')
  })

  it('sendConciergeMessage throws a generic error key on other failures', async () => {
    invokeResult = { data: null, error: { message: 'boom' } }
    await expect(sendConciergeMessage('acme', 'sess-1', 'hi')).rejects.toThrow('conciergeChat.error')
  })

  it('createConcierge inserts a concierge owned by the current user and returns it', async () => {
    insertResult = { data: { id: 'con-1', slug: 'acme' }, error: null }
    const result = await createConcierge({
      slug: 'acme',
      business_name: 'Acme',
      offer_description: 'A program',
      qa: 'Q/A',
      tone: 'friendly',
      language: 'de',
      calendar_url: 'https://cal.com/acme',
    })
    expect(capturedInsert?.table).toBe('concierges')
    expect(capturedInsert?.row).toMatchObject({
      owner_id: 'user-1',
      slug: 'acme',
      business_name: 'Acme',
      calendar_url: 'https://cal.com/acme',
    })
    expect(result).toEqual({ id: 'con-1', slug: 'acme' })
  })

  it('createConcierge throws when not signed in', async () => {
    userResult = { data: { user: null } }
    await expect(
      createConcierge({
        slug: 'acme',
        business_name: 'Acme',
        offer_description: 'x',
        qa: '',
        tone: 'friendly',
        language: 'de',
        calendar_url: 'https://cal.com/acme',
      }),
    ).rejects.toThrow('conciergeSetup.mustSignIn')
  })

  it('createConcierge maps a unique-violation to a duplicate-slug error key', async () => {
    insertResult = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
    await expect(
      createConcierge({
        slug: 'taken',
        business_name: 'Acme',
        offer_description: 'x',
        qa: '',
        tone: 'friendly',
        language: 'de',
        calendar_url: 'https://cal.com/acme',
      }),
    ).rejects.toThrow('conciergeSetup.slugTaken')
  })

  it('linkProvisionToConcierge invokes concierge-setup with the ids', async () => {
    invokeResult = { data: { ok: true }, error: null }
    await linkProvisionToConcierge('prov-1', 'con-1')
    expect(capturedInvoke?.name).toBe('concierge-setup')
    expect(capturedInvoke?.body).toEqual({ provisionId: 'prov-1', conciergeId: 'con-1' })
  })

  it('linkProvisionToConcierge throws saveFailed on error', async () => {
    invokeResult = { data: null, error: { message: 'persist_failed' } }
    await expect(linkProvisionToConcierge('prov-1', 'con-1')).rejects.toThrow('conciergeSetup.saveFailed')
  })
})
