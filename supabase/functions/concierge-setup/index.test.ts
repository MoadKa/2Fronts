import { assert, assertEquals, assertNotEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { handleConciergeSetup, FOLLOWUP_SENDER_ACK_VERSION, parseFollowupSender } from './index.ts'
import { verifyReplyToVerifyToken } from '../_shared/replyToVerifyMail.ts'

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
  // The row the sender-identity path reads BEFORE writing, to decide whether the
  // address it is about to store is the one that is currently verified.
  // `undefined` means the default row; `null` means no such (owned) concierge.
  conciergeBefore?: Record<string, unknown> | null
  conciergeSelectFilters?: Array<[string, unknown]>
}

const DEFAULT_BEFORE = {
  id: 'con-9',
  business_name: 'Acme Coaching',
  language: 'de',
  followup_reply_to: null,
  followup_reply_to_verified_at: null,
}

function fakeAdminClient(c: Captured) {
  return () => ({
    from(table: string) {
      if (table === 'concierges') {
        return {
          select(_columns: string) {
            const filters: Array<[string, unknown]> = []
            c.conciergeSelectFilters = filters
            const builder = {
              eq(column: string, value: unknown) {
                filters.push([column, value])
                return builder
              },
              maybeSingle: () =>
                Promise.resolve({
                  data: c.conciergeBefore === undefined ? DEFAULT_BEFORE : c.conciergeBefore,
                  error: null,
                }),
            }
            return builder
          },
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

// What the verification mail path saw. Every external effect it has is injected,
// so nothing here reaches a network.
interface MailSpy {
  sends: Array<{ to: unknown; subject: string; text?: string; idempotencyKey?: string }>
  capKeys: string[]
  capAllows: boolean
  sendOk: boolean
  throwOnSend?: boolean
}

const VERIFY_ENV: Record<string, string> = {
  FOLLOWUP_REPLY_TO_SECRET: 'test-reply-to-verify-secret',
  SUPABASE_URL: 'https://ref.supabase.test',
  RESEND_API_KEY: 're_test',
  FOLLOWUP_FROM_DOMAIN: '2Fronts <followup@2fronts.de>',
  FOLLOWUP_PUBLIC_BASE_URL: 'https://2fronts.de',
}

function mailSpy(overrides: Partial<MailSpy> = {}): MailSpy {
  return { sends: [], capKeys: [], capAllows: true, sendOk: true, ...overrides }
}

const deps = (
  c: Captured,
  uid: string | null = 'user-1',
  spy?: MailSpy,
  env: Record<string, string> = VERIFY_ENV,
) => ({
  createAdminClient: fakeAdminClient(c) as never,
  getUserId: () => Promise.resolve(uid),
  env: (key: string) => env[key],
  verifyMailCap: (key: string) => {
    spy?.capKeys.push(key)
    return Promise.resolve(spy?.capAllows ?? true)
  },
  sendMail: ((args: { to: unknown; subject: string; text?: string; idempotencyKey?: string }) => {
    if (spy?.throwOnSend) throw new Error('transport exploded')
    spy?.sends.push(args)
    return Promise.resolve({
      ok: spy?.sendOk ?? true,
      status: (spy?.sendOk ?? true) ? 200 : 422,
      retryable: false,
      indeterminate: false,
    })
  }) as never,
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
  // Typing an address is not proof of reading it: verification is its own step,
  // and this path only ever CLEARS the stamp, never sets it.
  assertEquals(patch.followup_reply_to_verified_at, null)
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
  assertNotEquals(patch.followup_reply_to_verified_at, '1999-01-01T00:00:00.000Z')
  assertEquals(patch.followup_reply_to_verified_at, null)
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
  // The owner-scoped read finds no row, so nothing is written and no mail goes
  // to whatever address the body named.
  const spy = mailSpy()
  const c: Captured = {
    provision: { config: {}, customerId: 'user-1' },
    updatePatch: null,
    conciergeBefore: null,
    conciergeRows: [],
  }
  const res = await handleConciergeSetup(
    postReq({ provisionId: 'prov-1', conciergeId: 'someone-elses-concierge', followupSender: validSender }),
    deps(c, 'user-1', spy),
  )
  assertEquals(res.status, 404)
  assertEquals((await res.json()).error, 'concierge_not_found')
  assertEquals(c.conciergePatch ?? null, null)
  assertEquals(spy.sends.length, 0)
})

// ---- The reply-to verification round-trip ----------------------------------
//
// decideSend() cancels every queued follow-up while
// followup_reply_to_verified_at is null, and only
// concierge-followup-verify-reply-to ever fills it. These tests cover the two
// halves this function owns: sending the mail that carries the link, and
// clearing the stamp whenever the address changes.

const CONCIERGE_UUID = '11111111-2222-4333-8444-555555555555'

function senderReq(replyTo = validSender.reply_to, conciergeId = CONCIERGE_UUID) {
  return postReq({
    provisionId: 'prov-1',
    conciergeId,
    followupSender: { ...validSender, reply_to: replyTo },
  })
}

Deno.test('saving an unverified reply-to sends the verification mail to that address', async () => {
  const spy = mailSpy()
  const c: Captured = { provision: { config: {}, customerId: 'user-1' }, updatePatch: null }
  const res = await handleConciergeSetup(senderReq(), deps(c, 'user-1', spy))
  const body = await res.json()

  assertEquals(res.status, 200)
  assertEquals(body.followupSaved, true)
  assertEquals(body.replyToVerified, false)
  assertEquals(body.verificationMailSent, true)

  assertEquals(spy.sends.length, 1)
  const sent = spy.sends[0]
  assertEquals(sent.to, validSender.reply_to)
  assertStringIncludes(sent.subject, 'Antwortadresse')
  // The mail carries a link, and it is the only one.
  assertEquals((sent.text ?? '').split('http').length - 1, 1)
  // Capped per concierge, so re-saving cannot become a mail cannon aimed at any
  // address the coach types.
  assertEquals(spy.capKeys, [`replyto-verify:${CONCIERGE_UUID}`])
})

Deno.test('the link in the mail carries a token bound to this concierge and this address', async () => {
  const spy = mailSpy()
  const c: Captured = { provision: { config: {}, customerId: 'user-1' }, updatePatch: null }
  await handleConciergeSetup(senderReq(), deps(c, 'user-1', spy))

  const url = (spy.sends[0].text ?? '').split('\n').find((l) => l.startsWith('https://'))
  assert(url, 'no verification URL in the mail')
  // The pretty route, not a *.supabase.co URL that reads as a phish.
  assertStringIncludes(url, 'https://2fronts.de/absender-bestaetigen?t=')
  const claim = await verifyReplyToVerifyToken(
    new URL(url).searchParams.get('t'),
    VERIFY_ENV.FOLLOWUP_REPLY_TO_SECRET,
  )
  assert(claim)
  assertEquals(claim.conciergeId, CONCIERGE_UUID)
  // The address itself never travels in the URL.
  assert(!url.includes(validSender.reply_to))
})

Deno.test('saving a DIFFERENT address clears the verification', async () => {
  const spy = mailSpy()
  const c: Captured = {
    provision: { config: {}, customerId: 'user-1' },
    updatePatch: null,
    conciergeBefore: {
      ...DEFAULT_BEFORE,
      followup_reply_to: 'alt@acme.de',
      followup_reply_to_verified_at: '2026-08-01T10:00:00.000Z',
    },
  }
  const res = await handleConciergeSetup(senderReq('neu@acme.de'), deps(c, 'user-1', spy))
  const body = await res.json()

  // A verification must never survive the address it verified.
  assertEquals(c.conciergePatch?.followup_reply_to_verified_at, null)
  assertEquals(c.conciergePatch?.followup_reply_to, 'neu@acme.de')
  assertEquals(body.replyToVerified, false)
  // And the coach is asked to verify the new one.
  assertEquals(spy.sends.length, 1)
  assertEquals(spy.sends[0].to, 'neu@acme.de')
})

Deno.test('re-saving the SAME verified address keeps the stamp and sends no mail', async () => {
  const spy = mailSpy()
  const c: Captured = {
    provision: { config: {}, customerId: 'user-1' },
    updatePatch: null,
    conciergeBefore: {
      ...DEFAULT_BEFORE,
      // Case and padding differ: it is the same mailbox.
      followup_reply_to: `  ${validSender.reply_to.toUpperCase()} `,
      followup_reply_to_verified_at: '2026-08-01T10:00:00.000Z',
    },
  }
  const res = await handleConciergeSetup(senderReq(), deps(c, 'user-1', spy))
  const body = await res.json()

  // The patch does not touch the column at all: not set, not cleared.
  assert(!('followup_reply_to_verified_at' in (c.conciergePatch ?? {})))
  assertEquals(body.replyToVerified, true)
  assertEquals(body.verificationMailSent, false)
  assertEquals(spy.sends.length, 0, 'a verified address was mailed again')
})

Deno.test('re-saving the same address that was never verified sends the mail again', async () => {
  const spy = mailSpy()
  const c: Captured = {
    provision: { config: {}, customerId: 'user-1' },
    updatePatch: null,
    conciergeBefore: {
      ...DEFAULT_BEFORE,
      followup_reply_to: validSender.reply_to,
      followup_reply_to_verified_at: null,
    },
  }
  const res = await handleConciergeSetup(senderReq(), deps(c, 'user-1', spy))
  assertEquals((await res.json()).verificationMailSent, true)
  assertEquals(spy.sends.length, 1)
})

Deno.test('this path NEVER sets the verification stamp, whatever the browser sends', async () => {
  const spy = mailSpy()
  const c: Captured = { provision: { config: {}, customerId: 'user-1' }, updatePatch: null }
  await handleConciergeSetup(
    postReq({
      provisionId: 'prov-1',
      conciergeId: CONCIERGE_UUID,
      followupSender: { ...validSender, followup_reply_to_verified_at: '2026-08-01T10:00:00.000Z' },
    }),
    deps(c, 'user-1', spy),
  )
  assertEquals(c.conciergePatch?.followup_reply_to_verified_at, null)
})

// ---- The mail is best-effort and never fails the save ----------------------

Deno.test('a rejected, capped, unconfigured or exploding mail still saves the identity', async () => {
  const cases: Array<[string, MailSpy, Record<string, string>]> = [
    ['rejected by Resend', mailSpy({ sendOk: false }), VERIFY_ENV],
    ['cap reached', mailSpy({ capAllows: false }), VERIFY_ENV],
    ['transport throws', mailSpy({ throwOnSend: true }), VERIFY_ENV],
    ['no secret configured', mailSpy(), { ...VERIFY_ENV, FOLLOWUP_REPLY_TO_SECRET: '' }],
    ['no api key configured', mailSpy(), { ...VERIFY_ENV, RESEND_API_KEY: '' }],
  ]
  for (const [label, spy, env] of cases) {
    const c: Captured = { provision: { config: {}, customerId: 'user-1' }, updatePatch: null }
    const res = await handleConciergeSetup(senderReq(), deps(c, 'user-1', spy, env))
    const body = await res.json()
    assertEquals(res.status, 200, label)
    assertEquals(body.followupSaved, true, label)
    // The save stands; only the mail is missing, and the send path reads a
    // missing verification as "do not send". It cannot fail open.
    assertEquals(body.verificationMailSent, false, label)
    assertEquals(c.conciergePatch?.followup_reply_to, validSender.reply_to, label)
  }
})

Deno.test('the verification mail falls back to the function URL without a public base', async () => {
  const spy = mailSpy()
  const c: Captured = { provision: { config: {}, customerId: 'user-1' }, updatePatch: null }
  const env = { ...VERIFY_ENV }
  delete (env as Record<string, string | undefined>).FOLLOWUP_PUBLIC_BASE_URL
  await handleConciergeSetup(senderReq(), deps(c, 'user-1', spy, env))
  assertStringIncludes(
    spy.sends[0].text ?? '',
    'https://ref.supabase.test/functions/v1/concierge-followup-verify-reply-to?t=',
  )
})

Deno.test('a concierge id that is not a UUID saves but cannot be sent a link', async () => {
  // signReplyToVerifyToken refuses a non-UUID id, so no unverifiable link is
  // ever put in front of a coach.
  const spy = mailSpy()
  const c: Captured = { provision: { config: {}, customerId: 'user-1' }, updatePatch: null }
  const res = await handleConciergeSetup(senderReq(validSender.reply_to, 'con-9'), deps(c, 'user-1', spy))
  assertEquals(res.status, 200)
  assertEquals((await res.json()).verificationMailSent, false)
  assertEquals(spy.sends.length, 0)
})

Deno.test('parseFollowupSender trims and requires the tick', () => {
  assertEquals(parseFollowupSender({ ...validSender, sender_block: '  Acme GmbH, Musterstr. 1  ' })?.sender_block, 'Acme GmbH, Musterstr. 1')
  assertEquals(parseFollowupSender({ ...validSender, ack: 'yes' }), null)
  assertEquals(parseFollowupSender(null), null)
  assertEquals(parseFollowupSender('nope'), null)
  assertEquals(parseFollowupSender({ ...validSender, sender_block: 'x'.repeat(501) }), null)
})
