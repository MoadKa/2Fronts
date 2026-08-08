import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  sendConciergeMessage,
  fetchConciergeIntro,
  createConcierge,
  linkProvisionToConcierge,
  listConciergeChats,
  listConciergeConsents,
  newSessionId,
} from './ConciergeService'

let invokeResult: { data: unknown; error: unknown } = { data: null, error: null }
let insertResult: { data: unknown; error: unknown } = { data: null, error: null }
let selectResult: { data: unknown; error: unknown } = { data: [], error: null }
let userResult: { data: { user: { id: string } | null } } = { data: { user: { id: 'user-1' } } }
let capturedInvoke: { name: string; body: unknown } | null = null
let capturedInsert: { table: string; row: Record<string, unknown> } | null = null
let capturedSelect: {
  table: string
  columns: string
  filters: Array<{ column: string; value: unknown }>
  limit?: number
} | null = null

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
      // A read chain thin enough to record what was asked for. The column list
      // is the interesting part: on concierge_consents a `select('*')` is a hard
      // permission error, not a silent over-fetch.
      select: (columns: string) => {
        capturedSelect = { table, columns, filters: [] }
        const chain = {
          eq: (column: string, value: unknown) => {
            capturedSelect?.filters.push({ column, value })
            return chain
          },
          // Awaitable AND chainable: some reads end at .order(), the consent
          // ledger read continues into .limit(). The limit is recorded because
          // the ledger read MUST be bounded — the public chat is
          // unauthenticated, so a stranger can grow a coach's ledger.
          order: () => ({
            then: (res: (v: typeof selectResult) => unknown) =>
              Promise.resolve(selectResult).then(res),
            limit: (n: number) => {
              if (capturedSelect) capturedSelect.limit = n
              return Promise.resolve(selectResult)
            },
          }),
        }
        return chain
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

  it('sendConciergeMessage carries the follow-up consent claim through untouched', async () => {
    // The three fields are a CLAIM about the screen the visitor saw. The server
    // re-renders the same wording from its own copy and refuses the row if they
    // disagree, so anything this layer added, renamed or dropped would either
    // invalidate a real consent or, worse, describe a screen that never existed.
    invokeResult = { data: { reply: 'Danke!', show_booking: false }, error: null }
    await sendConciergeMessage('acme', 'sess-1', 'Max', undefined, undefined, {
      name: 'Max',
      email: 'max@example.com',
      consent: {
        notice_version: 'concierge-followup-email-v1',
        locale: 'de',
        rendered_business_name: 'Coach Meyer',
      },
    })
    expect((capturedInvoke?.body as { contact?: unknown }).contact).toEqual({
      name: 'Max',
      email: 'max@example.com',
      consent: {
        notice_version: 'concierge-followup-email-v1',
        locale: 'de',
        rendered_business_name: 'Coach Meyer',
      },
    })
  })

  it('sendConciergeMessage sends no consent key at all when the caller gives none', async () => {
    // "No consent" has to reach the server as an ABSENT key, not as a present
    // one holding null/false. An unticked box and a box that was never rendered
    // must be indistinguishable on the wire — the moment they differ, the server
    // has a signal it can be tempted to store.
    invokeResult = { data: { reply: 'Danke!', show_booking: false }, error: null }
    await sendConciergeMessage('acme', 'sess-1', 'Max', undefined, undefined, {
      name: 'Max',
      email: 'max@example.com',
    })
    const contact = (capturedInvoke?.body as { contact: Record<string, unknown> }).contact
    expect('consent' in contact).toBe(false)
    expect(contact).toEqual({ name: 'Max', email: 'max@example.com' })
  })

  it('fetchConciergeIntro probes concierge-chat with slug + probe and returns language and name', async () => {
    // The public page asks which language a slug speaks BEFORE the first turn, so
    // its opening screen matches the coach's setting instead of the browser's.
    // The `probe: true` flag is what tells the server to skip the conversation
    // and the model — without it the server 400s and the feature silently dies.
    invokeResult = { data: { language: 'en', business_name: 'Acme' }, error: null }
    const result = await fetchConciergeIntro('acme')
    expect(capturedInvoke?.name).toBe('concierge-chat')
    expect(capturedInvoke?.body).toEqual({ slug: 'acme', probe: true })
    // is_demo and followup_available are absent from this payload on purpose: it
    // models an edge function deployed before those changes. BOTH must read
    // false. For is_demo, so a lagging deploy never makes a real coach's page
    // claim to be a demo. For followup_available, so a lagging deploy never
    // offers a consent checkbox whose promised confirmation mail the deployed
    // backend cannot send — that would put a false statement on the consent
    // screen and collect evidence of a consent nobody can honour.
    expect(result).toEqual({
      language: 'en',
      business_name: 'Acme',
      is_demo: false,
      followup_available: false,
    })
  })

  it('fetchConciergeIntro carries followup_available through', async () => {
    invokeResult = {
      data: { language: 'de', business_name: 'Acme', is_demo: false, followup_available: true },
      error: null,
    }
    expect((await fetchConciergeIntro('acme')).followup_available).toBe(true)
  })

  it('fetchConciergeIntro treats a non-boolean followup_available as false', async () => {
    invokeResult = {
      data: { language: 'de', business_name: 'Acme', followup_available: 'yes' },
      error: null,
    }
    expect((await fetchConciergeIntro('acme')).followup_available).toBe(false)
  })

  it('fetchConciergeIntro carries is_demo through so the page can disclose it', async () => {
    // A demo concierge speaks as a named real business. The page renders a visible
    // "this is a demo" line off this flag, so losing it in the service layer would
    // silently drop the disclosure while everything still looked fine.
    invokeResult = {
      // Invented fixture name on purpose: this repo is public, and tying a real
      // person to is_demo would publish a claim they never agreed to.
      data: { language: 'de', business_name: 'Beispiel Coaching', is_demo: true },
      error: null,
    }
    const result = await fetchConciergeIntro('beispiel-coaching')
    expect(result.is_demo).toBe(true)
  })

  it('fetchConciergeIntro treats a non-boolean is_demo as false', async () => {
    // Anything other than a literal true is not a demo. Fail toward "normal
    // page" rather than stamping a customer's setter with a demo notice.
    invokeResult = {
      data: { language: 'de', business_name: 'Acme', is_demo: 'yes' },
      error: null,
    }
    expect((await fetchConciergeIntro('acme')).is_demo).toBe(false)
  })

  it('fetchConciergeIntro throws conciergeChat.unavailable when the slug is not found', async () => {
    // Same key as the send path, so a dead link shows the same calm screen —
    // only now on arrival instead of after the visitor typed their name.
    invokeResult = {
      data: null,
      error: { context: { json: () => Promise.resolve({ error: 'not_found' }) } },
    }
    await expect(fetchConciergeIntro('nope')).rejects.toThrow('conciergeChat.unavailable')
  })

  it('fetchConciergeIntro throws the generic key on other failures (rate limit, network)', async () => {
    // A probe rides the same per-IP rate limiter as a real turn, so a 429 on page
    // load is reachable. It must map to the generic key the page swallows, NOT to
    // `unavailable` — otherwise a busy IP would see a dead-link screen.
    invokeResult = { data: null, error: { message: 'rate_limited' } }
    await expect(fetchConciergeIntro('acme')).rejects.toThrow('conciergeChat.error')
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

  // -------------------------------------------------------------------------
  // Reading the consent ledger from the dashboard
  // -------------------------------------------------------------------------

  it('listConciergeConsents asks for explicit columns, never *', async () => {
    // Migration 20260808120000 revokes table-level SELECT and grants it column by
    // column. A `select('*')` there is not a silent over-fetch, it is a hard
    // permission error that would blank the whole page. This test is the guard.
    selectResult = { data: [], error: null }
    await listConciergeConsents('con-1')
    expect(capturedSelect?.table).toBe('concierge_consents')
    expect(capturedSelect?.columns).not.toContain('*')
    expect(capturedSelect?.columns.length).toBeGreaterThan(0)
  })

  it('listConciergeConsents never asks for a column the coach is not granted', async () => {
    // Withheld by the migration: the visitor's IP, their user agent, and a live
    // confirmation token (which would let a coach confirm on their lead's behalf).
    selectResult = { data: [], error: null }
    await listConciergeConsents('con-1')
    for (const forbidden of [
      'visitor_ip',
      'visitor_user_agent',
      'confirm_token',
      'confirm_token_expires_at',
    ]) {
      expect(capturedSelect?.columns).not.toContain(forbidden)
    }
  })

  it('listConciergeConsents filters by the concierge and returns the rows', async () => {
    const rows = [
      { concierge_id: 'con-1', visitor_email_norm: 'a@b.de', action: 'granted', created_at: '2026-08-01T10:00:00Z' },
    ]
    selectResult = { data: rows, error: null }
    const out = await listConciergeConsents('con-1')
    expect(capturedSelect?.filters).toContainEqual({ column: 'concierge_id', value: 'con-1' })
    expect(out).toEqual(rows)
  })

  it('listConciergeConsents bounds the read', async () => {
    // The public chat is unauthenticated, so how many rows a coach's ledger
    // holds is not under the coach's control. An unbounded read turns their
    // Chats page into a payload a stranger can inflate.
    selectResult = { data: [], error: null }
    await listConciergeConsents('con-1')
    expect(capturedSelect?.limit).toBeGreaterThan(0)
  })

  it('listConciergeConsents returns an empty list rather than null when there is nothing', async () => {
    selectResult = { data: null, error: null }
    expect(await listConciergeConsents('con-1')).toEqual([])
  })

  it('listConciergeConsents surfaces a load failure as the page-level key', async () => {
    selectResult = { data: null, error: { message: 'permission denied for table concierge_consents' } }
    await expect(listConciergeConsents('con-1')).rejects.toThrow('conciergeChats.loadFailed')
  })

  it('listConciergeChats reads conversations, not the consent ledger', async () => {
    // The two are deliberately separate calls. listConciergeChats returns one row
    // per CONVERSATION, and consent belongs to an ADDRESS: a visitor with two
    // sessions must not show two different consent states.
    // No argument: RLS already scopes conversations to concierges the caller
    // owns, so this one needs no filter. listConciergeConsents DOES take an id,
    // because it is read per concierge.
    selectResult = { data: [], error: null }
    await listConciergeChats()
    expect(capturedSelect?.table).toBe('concierge_conversations')
    expect(capturedSelect?.columns).not.toContain('consent')
  })
})
