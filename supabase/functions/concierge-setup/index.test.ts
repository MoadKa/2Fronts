import { assertEquals, assertNotEquals } from 'jsr:@std/assert@1'
import { handleConciergeSetup, FOLLOWUP_SENDER_ACK_VERSION, parseFollowupSender } from './index.ts'

// Fake admin client modelling loadOwnedProvision (select config +
// automation_requests(customer_id)) and the config update. Mirrors the
// slack-configure test's shape.
interface Captured {
  provision: {
    config: Record<string, unknown>
    customerId: string | null
    // 'paid' is what lets the concierge go live; anything else links only.
    status?: string
  } | null
  updatePatch: Record<string, unknown> | null
  // The concierges-table write (activation, or the follow-up sender identity),
  // and whether the owner-scoped filter finds a row.
  conciergePatch?: Record<string, unknown> | null
  conciergeRows?: { id: string }[]
}

function fakeAdminClient(c: Captured) {
  return () => ({
    from(table: string) {
      if (table === 'concierges') {
        return {
          update(patch: Record<string, unknown>) {
            c.conciergePatch = patch
            // Chainable AND awaitable. Both writers now chain
            // .eq().eq().select(); the activation path additionally calls
            // .maybeSingle(), so select() must be awaitable AND carry it.
            // `conciergeRows` models what the owner-scoped filter matched:
            // an empty array is "this concierge is not yours".
            const rows = () => c.conciergeRows ?? [{ id: 'con-9' }]
            const selectResult = () => ({
              then: (res: (v: { data: { id: string }[]; error: null }) => unknown) =>
                Promise.resolve({ data: rows(), error: null }).then(res),
              maybeSingle: () =>
                Promise.resolve({ data: rows()[0] ?? null, error: null }),
            })
            const chain = {
              eq: () => chain,
              select: () => selectResult(),
              then: (res: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(res),
            }
            return chain
          },
        }
      }
      if (table !== 'automation_provisions') throw new Error(`unexpected table ${table}`)
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: () =>
                  Promise.resolve(
                    c.provision
                      ? {
                          data: {
                            config: c.provision.config,
                            automation_requests: {
                              customer_id: c.provision.customerId,
                              status: c.provision.status ?? 'requested',
                            },
                          },
                          error: null,
                        }
                      : { data: null, error: null },
                  ),
              }
            },
          }
        },
        update(patch: Record<string, unknown>) {
          c.updatePatch = patch
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
    },
  })
}

function postReq(body: unknown, auth = 'Bearer t') {
  return new Request('http://localhost/concierge-setup', {
    method: 'POST',
    headers: { Authorization: auth },
    body: JSON.stringify(body),
  })
}

const deps = (c: Captured, uid: string | null = 'user-1') => ({
  createAdminClient: fakeAdminClient(c) as never,
  getUserId: () => Promise.resolve(uid),
})

Deno.test('OPTIONS preflight returns CORS headers', async () => {
  const c: Captured = { provision: { config: {}, customerId: 'user-1' }, updatePatch: null }
  const res = await handleConciergeSetup(new Request('http://localhost/x', { method: 'OPTIONS' }), deps(c))
  assertEquals(res.status, 200)
  await res.body?.cancel()
})

Deno.test('links the concierge id onto the owning provision config', async () => {
  const c: Captured = { provision: { config: { existing: 1 }, customerId: 'user-1' }, updatePatch: null }
  const res = await handleConciergeSetup(postReq({ provisionId: 'prov-1', conciergeId: 'con-9' }), deps(c))
  assertEquals(res.status, 200)
  assertEquals((await res.json()).ok, true)
  // The concierge id is merged into config without losing existing keys.
  const cfg = c.updatePatch?.config as Record<string, unknown>
  assertEquals(cfg.concierge_id, 'con-9')
  assertEquals(cfg.existing, 1)
})

// ---- Activation is owner-scoped --------------------------------------------
//
// Regression, found 2026-08-08. The activation UPDATE filtered on the concierge
// id ALONE. `admin` is the service-role client, so RLS is not consulted and that
// filter was the only ownership check there was. Owning the provision proves
// nothing about owning the conciergeId the caller puts in the request body, so
// anyone holding one paid provision could name a stranger's concierge and switch
// it live with a bootstrap entitlement — including un-pausing a setter its owner
// had deliberately switched off.

Deno.test('activates the concierge when the request is paid', async () => {
  const c: Captured = {
    provision: { config: {}, customerId: 'user-1', status: 'paid' },
    updatePatch: null,
  }
  const res = await handleConciergeSetup(postReq({ provisionId: 'prov-1', conciergeId: 'con-9' }), deps(c))
  assertEquals(res.status, 200)
  assertEquals((await res.json()).activated, true)
  assertEquals(c.conciergePatch?.is_active, true)
  assertNotEquals(c.conciergePatch?.entitled_until, undefined)
})

Deno.test('refuses to activate a concierge the caller does not own', async () => {
  const c: Captured = {
    provision: { config: {}, customerId: 'user-1', status: 'paid' },
    updatePatch: null,
    // The owner-scoped filter matches nothing: con-9 belongs to someone else.
    conciergeRows: [],
  }
  const res = await handleConciergeSetup(postReq({ provisionId: 'prov-1', conciergeId: 'con-9' }), deps(c))
  assertEquals(res.status, 403)
  // And it must not answer 200 { activated: true } over a row it never touched.
  assertNotEquals((await res.json()).activated, true)
})

Deno.test('an unpaid provision links but never activates', async () => {
  const c: Captured = {
    provision: { config: {}, customerId: 'user-1', status: 'requested' },
    updatePatch: null,
  }
  const res = await handleConciergeSetup(postReq({ provisionId: 'prov-1', conciergeId: 'con-9' }), deps(c))
  assertEquals(res.status, 200)
  assertEquals((await res.json()).activated, false)
  // No concierges write at all on the unpaid path.
  assertEquals(c.conciergePatch ?? null, null)
})

Deno.test('rejects an unauthenticated caller with 401', async () => {
  const c: Captured = { provision: { config: {}, customerId: 'user-1' }, updatePatch: null }
  const res = await handleConciergeSetup(postReq({ provisionId: 'prov-1', conciergeId: 'con-9' }), deps(c, null))
  assertEquals(res.status, 401)
  assertEquals(c.updatePatch, null)
})

Deno.test('rejects a caller who does not own the provision with 403', async () => {
  const c: Captured = { provision: { config: {}, customerId: 'someone-else' }, updatePatch: null }
  const res = await handleConciergeSetup(postReq({ provisionId: 'prov-1', conciergeId: 'con-9' }), deps(c, 'user-1'))
  assertEquals(res.status, 403)
  assertEquals(c.updatePatch, null)
})

Deno.test('returns 404 when the provision does not exist', async () => {
  const c: Captured = { provision: null, updatePatch: null }
  const res = await handleConciergeSetup(postReq({ provisionId: 'nope', conciergeId: 'con-9' }), deps(c))
  assertEquals(res.status, 404)
})

Deno.test('returns 400 when provisionId or conciergeId is missing', async () => {
  const c: Captured = { provision: { config: {}, customerId: 'user-1' }, updatePatch: null }
  const res = await handleConciergeSetup(postReq({ provisionId: 'prov-1' }), deps(c))
  assertEquals(res.status, 400)
  assertEquals(c.updatePatch, null)
})

// ---- Follow-up sender identity ---------------------------------------------

const validSender = {
  sender_block: 'Acme Coaching GmbH, Musterstr. 1, 45127 Essen',
  privacy_url: 'https://acme.de/datenschutz',
  reply_to: 'hallo@acme.de',
  ack: true,
}

Deno.test('stamps the sender acknowledgement server-side when the coach ticks it', async () => {
  const c: Captured = { provision: { config: {}, customerId: 'user-1' }, updatePatch: null }
  const res = await handleConciergeSetup(
    postReq({ provisionId: 'prov-1', conciergeId: 'con-9', followupSender: validSender }),
    deps(c),
  )
  assertEquals(res.status, 200)
  assertEquals((await res.json()).followupSaved, true)

  const patch = c.conciergePatch as Record<string, unknown>
  assertEquals(patch.followup_sender_block, validSender.sender_block)
  assertEquals(patch.followup_privacy_url, validSender.privacy_url)
  assertEquals(patch.followup_reply_to, validSender.reply_to)
  assertEquals(patch.followup_enabled, true)
  // The two locked columns: written HERE, with the service role, and nowhere else.
  assertEquals(patch.followup_sender_ack_version, FOLLOWUP_SENDER_ACK_VERSION)
  assertNotEquals(patch.followup_sender_ack_at, undefined)
  // Typing an address is not proof of reading it: verification is its own step.
  assertEquals(patch.followup_reply_to_verified_at, undefined)
  // A sender-identity call must not re-run the provision write (fulfillment may
  // have moved the provision past 'provisioning' by now).
  assertEquals(c.updatePatch, null)
})

Deno.test('ignores an ack_at / ack_version smuggled in by the browser', async () => {
  const c: Captured = { provision: { config: {}, customerId: 'user-1' }, updatePatch: null }
  const res = await handleConciergeSetup(
    postReq({
      provisionId: 'prov-1',
      conciergeId: 'con-9',
      followupSender: {
        ...validSender,
        followup_sender_ack_at: '1999-01-01T00:00:00.000Z',
        followup_sender_ack_version: 'forged-v99',
        followup_reply_to_verified_at: '1999-01-01T00:00:00.000Z',
      },
    }),
    deps(c),
  )
  assertEquals(res.status, 200)
  const patch = c.conciergePatch as Record<string, unknown>
  assertEquals(patch.followup_sender_ack_version, FOLLOWUP_SENDER_ACK_VERSION)
  assertNotEquals(patch.followup_sender_ack_at, '1999-01-01T00:00:00.000Z')
  assertEquals(patch.followup_reply_to_verified_at, undefined)
})

Deno.test('refuses an incomplete sender identity with 400 and writes nothing', async () => {
  for (
    const bad of [
      { ...validSender, ack: false }, // not acknowledged
      { ...validSender, sender_block: '   ' }, // no §5 DDG block
      { ...validSender, privacy_url: 'not-a-url' },
      { ...validSender, privacy_url: 'javascript:alert(1)' },
      { ...validSender, reply_to: 'not-an-email' },
    ]
  ) {
    const c: Captured = { provision: { config: {}, customerId: 'user-1' }, updatePatch: null }
    const res = await handleConciergeSetup(
      postReq({ provisionId: 'prov-1', conciergeId: 'con-9', followupSender: bad }),
      deps(c),
    )
    assertEquals(res.status, 400)
    assertEquals((await res.json()).error, 'followup_invalid')
    assertEquals(c.conciergePatch ?? null, null)
  }
})

Deno.test('refuses to stamp a concierge the caller does not own', async () => {
  // Owning the provision says nothing about owning the concierge id in the body.
  // The owner-scoped filter matches no row, so the write lands nowhere.
  const c: Captured = { provision: { config: {}, customerId: 'user-1' }, updatePatch: null, conciergeRows: [] }
  const res = await handleConciergeSetup(
    postReq({ provisionId: 'prov-1', conciergeId: 'someone-elses-concierge', followupSender: validSender }),
    deps(c),
  )
  assertEquals(res.status, 404)
  assertEquals((await res.json()).error, 'concierge_not_found')
})

Deno.test('parseFollowupSender trims and requires the tick', () => {
  assertEquals(parseFollowupSender({ ...validSender, sender_block: '  Acme GmbH, Musterstr. 1  ' })?.sender_block, 'Acme GmbH, Musterstr. 1')
  assertEquals(parseFollowupSender({ ...validSender, ack: 'yes' }), null)
  assertEquals(parseFollowupSender(null), null)
  assertEquals(parseFollowupSender('nope'), null)
  assertEquals(parseFollowupSender({ ...validSender, sender_block: 'x'.repeat(501) }), null)
})
