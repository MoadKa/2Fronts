# TODOS

Reorganized 2026-07-12 by `/ship` into the gstack canonical format (component
groupings, P0-P4 priority, dedicated Completed section). Content preserved
verbatim from the original captures — only structure changed.

## Missed-Call Recovery (Twilio) — RETIRED 2026-08-07

> The product was withdrawn on 2026-08-07 (German prospects do not use SMS). The
> connector, both webhooks and the number-purchasing helper were deleted; the
> automation is delisted and its rows marked cancelled. Tables and columns were
> kept. The items below are what the retirement left open.

### Release the purchased Twilio numbers and close the account

**What:** Any phone number bought through the old missed-call flow is still owned and billed at Twilio, and now points at webhook URLs that 404. There is no deprovision path left in code — `twilioProvision.ts` was deleted with the product.

**Why:** Recurring cost for a dead product, and a live number answering nothing is worse than no number.

**Context:** `automation_provisions.twilio_phone_number` / `twilio_phone_number_sid` still hold the SIDs needed to release them. Migration `20260807160000` marks the rows cancelled but cannot touch Twilio itself.

**Effort:** S (manual, Twilio console)
**Priority:** P2
**Depends on:** Nothing.

### Retention decision for `automation_provision_opt_outs`

**What:** Decide whether to keep or delete the rows.

**Why:** It stores bare phone numbers of third parties who replied STOP. Their stated purpose — suppressing SMS that can no longer be sent — no longer exists, which under DSGVO Art. 5(1)(e) is personal data retained past its purpose.

**Context:** Flagged by the data-migration review during `/ship` on 2026-08-07. Kept for now as history rather than deleted silently; this is a decision, not an oversight.

**Correction (2026-08-08):** an earlier version of this entry claimed the table was fully orphaned because its only writer was deleted from the repo. That was **wrong** and the third adversarial review caught it. `supabase functions deploy` does not prune, so the deployed `twilio-sms-webhook` keeps running its last-deployed bundle: it looks a provision up by `twilio_phone_number` with no status filter and inserts the caller's number into this table. As long as the numbers are owned and still routed to it, it is **actively writing new personal data**. Deleting the function (see the deploy note in the item above) is therefore a prerequisite for this decision, not merely related to it.

**Effort:** S
**Priority:** P2
**Depends on:** `supabase functions delete twilio-sms-webhook` must land first, otherwise the table refills.

### Provisions can get stuck in `provisioning` with no recovery path

**What:** If an edge function times out or crashes between `runConnectorProvision`'s claim and its outcome write, the row stays `provisioning` forever. `retry-provision` only accepts rows whose status is `failed` (returns 404 otherwise), and the claim is guarded on `fromStatus`, so neither a redelivered webhook nor an admin Retry can pick it back up. Recovery needs a manual UPDATE.

**Why:** A paid customer sits with an unfulfilled automation and no self-service or admin route to fix it.

**Context:** Pre-existing shape (the deleted `attemptProvision` had the same two-statement gap), surfaced by the data-migration review on 2026-08-07 when the logic was generalised to every connector. Fix is either letting retry accept stale `provisioning` rows, or a reaper that returns them to `failed`.

**Effort:** M
**Priority:** P2
**Depends on:** Nothing.

### Orphaned phone / call-forwarding UI and its strings

**What:** `MyRequestsPage.tsx` (lines ~89, 112, 117-125) and `AdminRequestsPage.tsx` (~107-108) still render the Twilio phone number and the call-forwarding instructions, gated on `provision.twilio_phone_number`. Nothing writes that column any more. Their i18n strings go with them: `myRequests.forwardingSummary`, `forwardingStep1-4`, `myRequests.active`. Separately, `myRequests.settingUp` / `failedPrefix` interpolate `provision.business_name`, which no write path sets, so the slot renders empty.

**Why:** Dead UI that advertises a number whose webhooks now 404, plus a visibly empty placeholder in a customer-facing sentence.

**Context:** Found by the maintainability review during `/review` on 2026-08-07. Left out of that PR to keep the diff focused on the payment path.

**Effort:** S
**Priority:** P3
**Depends on:** Nothing.

### Rename `AttemptProvisionResult` and break the connectors/provisioning cycle

**What:** The type is named after `attemptProvision`, deleted on 2026-08-07. It also creates a module cycle: `connectors.ts` imports the type from `provisioning.ts` while `provisioning.ts` imports `Connector`/`ConnectorDeps`/`ProvisionRow` back. Moving it into `connectors.ts` next to the `Connector` interface (as `ProvisionResult`) removes both problems.

**Why:** The name points at code that no longer exists, and the cycle makes the module graph harder to reason about than it needs to be.

**Context:** Maintainability review, 2026-08-07.

**Effort:** S
**Priority:** P4
**Depends on:** Nothing.

### `RETIRED_CONNECTOR_TYPES` is mirrored with nothing enforcing it

**What:** The list exists twice, in `supabase/functions/_shared/connectors.ts` and `src/services/RequestService.ts`. The duplication is defensible (Deno edge functions and the Vite bundle share no module graph), but nothing keeps them in sync. Retiring a second connector will update one copy and the failure is silent: the client stops warning and the user gets a raw server error instead. The thrown message is also raw English reaching a German customer.

**Why:** Silent drift on a guard whose whole job is to fail loudly.

**Context:** Maintainability review, 2026-08-07.

**Effort:** S
**Priority:** P3
**Depends on:** Nothing.

### Active failure alerting (email/Slack) on provisioning failure

**What:** Push a notification (email or Slack webhook) when `automation_provisions.status` flips to `failed`, instead of relying on someone checking `AdminRequestsPage`.

**Why:** A paid customer with a silently-failed provision and no one watching the admin panel is a refund-support incident with no defined owner.

**Context:** v1 persists `status: 'failed'` and surfaces it in the UI (Issue 7 of the eng review), but nothing actively pushes a notification. Flagged in the design doc's Failure Modes section.

**Effort:** M
**Priority:** P2
**Depends on:** Nothing — needed before scaling past one customer, not before pilot launch.

### Number-recycling / deprovisioning lifecycle

**What:** Design what happens to a cancelled customer's Twilio number once Twilio eventually releases and reassigns it to someone else.

**Why:** A stale `automation_provisions` row could route a new customer's calls using old config, or the unique constraint on `twilio_phone_number` could block reprovisioning a recycled number entirely.

**Context:** Current schema has a `cancelled` status on `automation_provisions` but no release/cleanup logic tied to it. Flagged by the outside-voice review during /plan-eng-review, not caught by the initial architecture review.

**Effort:** M
**Priority:** P3
**Depends on:** Nothing blocking — can be designed anytime, but no urgency until customer #1 actually cancels.

### Per-tenant carrier registration for future market expansion (e.g. US 10DLC)

**What:** Investigate whether carriers require per-business (not platform-level) registration for SMS sending if/when expanding beyond Germany — e.g. US 10DLC brand/campaign registration is likely per-business.

**Why:** The "one platform Twilio credential" architecture assumes platform-level is sufficient. That may not hold in every market.

**Context:** Outside-voice review flagged this during /plan-eng-review. Germany-specific dependencies (already added to the design doc) cover the current market; this TODO is purely about future expansion.

**Effort:** S (investigation)
**Priority:** P4
**Depends on:** A decision to expand beyond Germany.

## Billing / Checkout

### No expiry/cleanup for abandoned-checkout `automation_provisions` rows stuck in `pending`

**What:** `createProvisionDetails` inserts a `pending` provision row before checkout starts (`AutomationDetailPage.handleRequest`). If the customer abandons checkout (closes the tab at the Stripe page, payment fails, etc.), that row has no expiry, no cleanup job, and no cancel path — it sits in `pending` forever, and `MyRequestsPage` shows "Setting up..." indefinitely with nothing to act on.

**Why:** Real data-hygiene gap, not a security hole — but it means `automation_provisions` will accumulate dead rows tied to never-paid requests as soon as more than a handful of customers touch checkout, and the customer-facing UI gives no indication anything is wrong.

**Context:** Found by `/ship`'s Claude adversarial review on 2026-06-21. Note (2026-07-12): the v1.14.0.0 trial reinstatement adds a related self-heal path for provisions missing a subscription id, but does not address abandoned-pending rows with no subscription attempt at all.

**Effort:** M (needs a design decision: TTL? explicit cancel button? cron sweep?)
**Priority:** P2
**Depends on:** Nothing blocking, but should be designed before scaling past the pilot customer.

## Integrations / OAuth

### Pass Google OAuth app verification

**What:** Take the Google OAuth app through Google's verification process so users outside the test-user allowlist can complete the consent flow.

**Why:** Until the app is verified, only allowlisted test accounts can connect Google Sheets; a real customer's consent will be blocked or warning-gated.

**Context:** Build seam #4. Process notes captured in `supabase/functions/_shared/README-google-verification.md`.

**Effort:** L (external review process, own timeline)
**Priority:** P1
**Depends on:** A published privacy policy and the production OAuth client configured.

### CSRF / `state`-signing on the OAuth callback

**What:** Sign (or otherwise bind to a session) the OAuth `state` parameter so a stale or forged `state` can't be replayed against the callback.

**Why:** The callback already fails closed on an *unknown* provision, but the `state` value itself is not signed — it's a bare provision id. Signing it is standard OAuth CSRF hardening before non-pilot traffic.

**Context:** Listed as integration seam #2 during the connector pipeline build; deferred out of v0.2.0.0 as hardening rather than a launch blocker.

**Effort:** S
**Priority:** P2
**Depends on:** Nothing blocking.

## AI Booking Concierge

### Rate-limit the public `concierge-chat` endpoint

**What:** Add per-IP / per-session rate limiting (and a sane request cap) to `supabase/functions/concierge-chat/index.ts`, which is public (`--no-verify-jwt`) and calls Gemini on every request.

**Why:** A public, unauthenticated endpoint that hits an LLM per call is a cost-abuse vector — someone could hammer it and run up the Gemini bill. Low risk at pilot volume, real risk at scale.

**Context:** Flagged by `/ship`'s pre-landing review of the AI Booking Concierge (epic #22, v1.0.0.0). Note (2026-07-12): v1.14.0.0 adds a paid trial funnel that will drive real outreach traffic to this endpoint — the cost-abuse exposure window is closing.

**Effort:** M
**Priority:** P1
**Depends on:** Nothing blocking.

### Rate-limit key can be minted by the client via `x-forwarded-for`

**What:** `clientIp()` in `supabase/functions/concierge-chat/index.ts` takes the FIRST entry of `x-forwarded-for` (`if (fwd) return fwd.split(',')[0].trim()`). Proxies typically *append* the real client IP, so the first entry is the value the caller supplied — rotating a fake header per request yields a fresh rate-limit bucket every time. Prefer a platform-authoritative client-IP header, or take the LAST entry (the hop the trusted proxy appended).

**Why:** The per-IP limiter is the only spend guard on a public, no-JWT endpoint that calls Gemini. If the key can be minted at will, the guard is decorative under a deliberate attacker. Bounded in practice: it protects a Gemini bill, not private data, and no abuse has been observed.

**Context:** Flagged by the security specialist during `/ship`'s pre-landing review of the concierge language fix (v1.15.5.0), confidence 6/10. Pre-existing (`clientIp` is unchanged by that branch) and deliberately not fixed there, because getting it right needs knowledge of exactly which headers Supabase Edge sets and trusts — a wrong guess silently disables rate limiting entirely.

**Effort:** S
**Priority:** P2
**Depends on:** Confirming Supabase Edge's trusted proxy header behaviour first.

### Minify + cache `public/embed.js`, and defer its auto-open iframe mount

**What:** `public/embed.js` (~6KB, unminified) is fetched fresh on every page view of every coach's third-party website with no explicit `Cache-Control` in `vercel.json`. Separately, the optional `data-auto-open` feature mounts the full chat iframe on a bare `setTimeout`, competing with the host page's own critical rendering path.

**Why:** This is the one file in the repo whose bytes and load timing directly add to *someone else's* site performance, not just ours — worth a deliberate build/cache step once more than a handful of coaches install it.

**Context:** Flagged by the performance specialist during `/ship`'s pre-landing review of the embed widget (v1.14.1.0).

**Effort:** S
**Priority:** P2
**Depends on:** Nothing blocking — do before the widget sees meaningful install volume.

### Embed widget: iframe load-failure fallback + Shadow DOM style isolation

**What:** Two related hardening gaps in `public/embed.js`: (a) the lazily-created chat iframe has no load-failure handling — a CSP block, ad blocker, deleted slug, or network failure leaves the panel open and permanently blank with zero fallback message; (b) the bubble/panel chrome has no Shadow DOM isolation and no `!important`, so an aggressive host-page CSS reset (common in some WordPress/Wix/Squarespace themes) could silently override its position/visibility.

**Why:** Both are silent-failure modes specific to running on domains we don't control — the coach or visitor would see a broken/invisible widget with no diagnostic signal.

**Context:** Flagged by the red-team pass during `/ship`'s pre-landing review of the embed widget (v1.14.1.0). The related dynamic-injection edge case (`document.currentScript` unavailable via tag managers falls back to the first `script[data-concierge]` tag in the DOM, which could resolve to the wrong slug if two widgets are injected that way) is a lower-severity variant of the same risk class — worth revisiting together.

**Effort:** M
**Priority:** P2
**Depends on:** Nothing blocking — no reported breakage yet, this is proactive hardening.

### Minor cleanup nits from the embed-widget review (DRY + coverage of defensive branches)

**What:** Small, low-confidence findings from `/ship`'s testing and maintainability specialists on the embed widget: the `.claude`/`.worktrees` ignore paths are duplicated verbatim in `eslint.config.js` and `vite.config.ts`; the `{source:'tf-embed',type:'escape'}` postMessage contract shape is duplicated as inline literals across `public/embed.js`, `ConciergePublicPage.tsx`, and both test files with no shared constant; a few defensive branches in `public/embed.js` (sessionStorage blocked, `new URL()` throw, legacy `'Esc'` key alias, empty `slugs=[]` in `ConciergeEmbedSection`) have no dedicated test.

**Why:** None of these are bugs — consistency/coverage gaps flagged at confidence too low to auto-fix or block shipping; bundled since none block anything.

**Effort:** S
**Priority:** P3
**Depends on:** Nothing blocking.

## Marketplace / Growth

### "AI" marketing framing vs. fixed-template reality

**What:** Decide how to position the product given v1's actual mechanism (missed-call recovery) is a fixed 3-field SMS template with zero LLM inference, while the target customer's mental model and the product's own framing is "AI."

**Why:** Named competitors (Aira, Allo) may offer real conversational AI texting. If a customer or competitor comparison reveals v1 is a static template, that's a credibility risk against the "AI-built" framing the whole go-to-market plan relies on. (Note: the separate AI Booking Concierge product line, unlike missed-call recovery, does run a real LLM per conversation — this TODO is specific to the missed-call template.)

**Context:** Flagged by the outside-voice review during /plan-eng-review. Doesn't block any engineering work in this plan.

**Effort:** S (positioning decision, no code)
**Priority:** P2
**Depends on:** Nothing — should be resolved before marketing copy/pricing page goes live, not before engineering starts.

### Promote the marketplace Wizard-of-Oz capture-form relay into the real customer-intake mechanism, if the test validates

**What:** If the marketplace Wizard-of-Oz demand test (see `/office-hours` design doc `akaou-main-design-20260620-185237.md` and `/plan-ceo-review` CEO plan `2026-06-20-marketplace-wizard-of-oz-test.md`) produces a go signal, reuse the throwaway capture-form's relay edge function as the seed of the real customer-intake mechanism for Approach B (the full dev-upload platform), instead of rebuilding intake from scratch.

**Why:** The relay function (capture form → server-side secret → webhook/email) already works once built for the test; rebuilding the same capability later would be pure waste if the underlying idea validates.

**Context:** Surfaced during `/plan-ceo-review`'s Section 6/Test review pass on the Wizard-of-Oz test plan. Only actionable once the test concludes with a go signal (Success Criteria: 2-3 owners complete real integration setup and keep using it for a week, AND the named developer ships a working listing unprompted). If the test produces a kill signal instead, this TODO is dead weight and should be deleted, not carried forward indefinitely.

**Effort:** S (direct reuse)
**Priority:** P4
**Depends on:** The Wizard-of-Oz test's go/kill outcome (not yet known — test hasn't run).

### Consider a downloadable local agent as the universal integration mechanism for Approach B

**What:** Instead of building a bespoke API integration per customer's CRM/website (which doesn't scale — every business uses a different tool), investigate a small downloadable local agent (e.g. a lightweight Electron/Tauri app, or even a simple scheduled script) that runs on the customer's own machine and performs the automation locally, without needing per-target API integration work.

**Why:** Surfaced during `/plan-eng-review`'s outside-voice pass on the Wizard-of-Oz test plan, in response to the founder asking whether a downloadable app could be a fallback when a business's tool has no usable API. This could be the mechanism that makes Approach B (the real dev-upload platform) tractable instead of an integration-per-target nightmare. Asking a stranger to download and run unsigned/unknown code on their business PC is arguably a bigger trust ask than OAuth-style permissions to a known CRM, not a smaller one — this needs real thought before assuming it's the easier path. Also nontrivial to build (cross-platform packaging, distribution, trust/signing).

**Context:** Not relevant to the current Wizard-of-Oz test (explicitly rejected as over-scoped for testing with one customer this week — see the design doc's Assignment, which uses a feasibility check + hand-built per-customer script instead). Only relevant if/when Approach B gets greenlit.

**Effort:** XL
**Priority:** P4
**Depends on:** A go signal from the current Wizard-of-Oz test, and a decision to actually build Approach B.

## Legal / Business

### Resolve whether a Gewerbe (business registration) is needed to legally invoice/accept payment in Germany

**What:** Get a real answer (Steuerberater or Anwalt, not this codebase) on whether the founder needs to register a business to legally sell automations and accept payment via Stripe in Germany, independent of which country issues the Twilio phone number.

**Why:** The provisioning architecture was switched to Finnish (+358) numbers specifically to avoid Twilio's German number-assignment requirement (a BNetzA telecom rule), which is unrelated to whether operating the business itself requires registration. That second question was never resolved — it was explicitly deferred, not answered, when the Finnish-number decision was made (2026-06-20).

**Context:** Surfaced during the Twilio provisioning country decision. The Finnish-number switch is a legitimate technical choice (sidesteps Twilio's number-specific KYC) but explicitly does not answer this separate question. Note (2026-07-12): v1.14.0.0 ships a real card-first trial with real Stripe billing — this makes the legal-registration question materially more urgent than when it was first deferred.

**Effort:** S (external consultation, no code)
**Priority:** P1
**Depends on:** Nothing blocking engineering work, but should be resolved before the first real customer pays.

## Email / Notifications

### Three Resend transports in the tree — migrate `notify-request` and `submit-wish` onto `_shared/email.ts`

**What:** The Resend HTTP call now exists three times: the new shared transport `supabase/functions/_shared/email.ts`, and an inline `defaultSendEmail` in each of `supabase/functions/notify-request/index.ts` and `supabase/functions/submit-wish/index.ts`. Both older copies are byte-for-byte the same idea — POST to `https://api.resend.com/emails`, return a bare `boolean` — and both should be deleted in favour of `sendEmail()`.

**Why:** The two inline copies collapse every failure into `false`, which cannot distinguish "Resend rejected this" from "we never learned the outcome". Any future change to how we talk to Resend (a header, an endpoint version, a redaction rule) has to be made in three places, and the shared module is the only one of the three that redacts the API key out of error strings or reports retry semantics. Divergence here is silent by construction: nothing fails if only one copy is updated.

**Context:** `_shared/email.ts` was added deliberately without touching the two callers, to keep the follow-up consent-chain diff reviewable. The migration is mechanical but not free: both callers' `SendEmailFn` type is exported and injected by their own tests (`notify-request/index.test.ts`, `submit-wish/index.test.ts`), so the fakes those tests inject must move from returning `boolean` to returning a `SendEmailResult`. Both call sites are best-effort notifications that only care about `ok`, so no behaviour needs to change.

**Effort:** M
**Priority:** P3
**Depends on:** Nothing.

## Completed

### Connector pipeline go-live: set the required secrets

**What:** Set the Supabase secrets the connector fulfillment pipeline reads: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` (→ the deployed google-oauth-callback URL), `CONNECTOR_TOKEN_KEY` (base64 32-byte AES-GCM key), `GEMINI_API_KEY`, `ALERT_WEBHOOK_URL`, and optionally `INTAKE_SECRET`.

**Why:** The code is built and unit-tested against injected fakes, but every live path (OAuth token exchange, Sheets REST calls, the Gemini mapping call, ops alerting) is dead until these are set.

**Context:** Shipped in v0.2.0.0 (connector fulfillment pipeline). `CONNECTOR_TOKEN_KEY` and `INTAKE_SECRET` values were generated for the founder during the build session; the Google + Gemini + alert values come from their respective consoles.

**Status:** All seven secrets set on live project `fettkrnajxbrfvwbenzf` from `.env` via `supabase secrets set --env-file`. Fixed a double-slash typo in `GOOGLE_OAUTH_REDIRECT_URI` (`.co//functions` → `.co/functions`) in `.env` before setting. Live Google Sheets / Gemini / OAuth-exchange paths are still untested against real APIs.

**Completed:** v0.2.0.0 (2026-06-22)

### Decide the `INTAKE_SECRET` posture (intake endpoint is open by default)

**What:** Decide whether `INTAKE_SECRET` is mandatory in production. When it is unset, the `intake` endpoint accepts a lead for any existing `customer_id` with no authentication.

**Why:** Without the secret, anyone who learns a valid `customer_id` can inject leads into that customer's pipeline (the database foreign key blocks non-existent customers, so the blast radius is spam into a real customer's `needs_review` queue, not arbitrary writes). Setting the secret closes it.

**Context:** Flagged as the single informational finding in `/ship`'s pre-landing review of the connector pipeline (v0.2.0.0). The endpoint deliberately ships open-by-default with the gate behind an env var.

**Status:** Decision = gate it. `INTAKE_SECRET` is set on the live project, so the intake endpoint now requires the `x-intake-secret` header. Any legitimate lead source must send that header. Value lives in `.env` (gitignored).

**Completed:** v0.2.0.0 (2026-06-22)

### Spreadsheet picker → run `configure()` to populate the proposed mapping

**What:** Build the missing slice between "customer connected Google" and "customer sees a proposed mapping": a spreadsheet picker that runs `googleSheetsConnector.configure()` and writes the resulting `proposedMapping` into the provision's `config`.

**Why:** Today the confirm screen reads `config.proposedMapping`, but nothing populates it — so after connecting, the customer lands on the confirm page's graceful empty state instead of an actual mapping to approve. The pipeline can't file a lead end-to-end until this exists.

**Context:** Build seam #5 — the one genuinely unfinished functional gap in the v0.2.0.0 pipeline (every other connector verb is wired and tested).

**Status:** Built in the fulfillment-loop PR (closes issue #3). Paste-a-URL picker on the confirm screen → `connect-configure` edge function runs `googleSheetsConnector.configure()` and writes `config.proposedMapping` + `config.spreadsheetId`. Also closed the connect→configure→confirm→run loop: a token-refresh helper (`googleAuth`), lead filing wired into `intake` via `leadFiling`, and the `columnMapping`/`confirmedMapping` key-mismatch bug fixed. The live connect/file path is still untested against real Google APIs (happens at deploy). Remaining loop gap: deploy migration + functions to Supabase.

**Completed:** v0.2.0.0 (2026-06-22)

### Cap visitor message length in `concierge-chat`

**What:** Reject or truncate oversized `message` input in the concierge chat handler before it goes into the Gemini prompt.

**Why:** Same cost-abuse category as the rate-limiting TODO above — an unbounded message inflates the prompt and the bill. Cheap to fix (one length check next to the existing input validation).

**Context:** Flagged by `/ship`'s pre-landing review (epic #22, v1.0.0.0).

**Status:** `concierge-chat/index.ts` now rejects `message` > 2000 chars (`message_too_long`) and `session_id` > 256 chars (`session_id_too_long`) before any DB/Gemini call.

**Completed:** v1.0.1.0 (2026-06-25)

## Follow-up sender identity — reachable only once (2026-08-08)

- [ ] **No way back into the sender-identity panel.** It lives on the wizard's
      "you're live" screen at `/connect/:provisionId/confirm`. Once the wizard
      completes, `MyRequestsPage.tsx:76` swaps the "Set up your setter" link for
      "Open dashboard", and the wizard itself always starts at `step: 'welcome'`
      with no load of an existing concierge — re-entering it would try to create
      a SECOND concierge, not edit the first. So a coach who skips the panel can
      never come back to it.
      The copy used to promise "Du kannst das jederzeit später erledigen"; that
      was corrected to say the opposite rather than leave a false promise
      standing. The real fix is a settings surface under `/app/` that edits
      `followup_sender_block` / `followup_privacy_url` / `followup_reply_to`,
      with `concierge-setup`'s owner-scoped service-side ack write behind it.
- [ ] **`followup_reply_to_verified_at` is never set by anything.** The wizard
      deliberately does not stamp it (typing an address is not proof of reading
      it), and no verification round-trip exists yet. Until one does, any send
      path that requires a verified reply-to will refuse every row. Build the
      round-trip, or decide explicitly that the ack alone is the gate.
- [ ] **The ack wording and its version constant can drift apart.** The text is
      `conciergeOnboarding.followup.ackLabel` in both locale files;
      `FOLLOWUP_SENDER_ACK_VERSION` lives in `concierge-setup/index.ts`. Nothing
      links them, so a copy edit can silently invalidate stored evidence. Mirror
      it the way `src/lib/consent.test.ts` mirrors the consent wording.

## Follow-up consent — open findings from the pre-landing review (2026-08-08)

Found by an adversarial review of the consent chain. The mail-cannon chain
(dead caps + re-armable grant + demo not excluded) was FIXED before landing;
these survived triage and are recorded rather than rushed.

- [ ] **P1 — Decide whether a consent survives a business-name change, BEFORE
      the send path is built.** The notice a visitor agreed to says "Sie gilt
      nur für {business_name}". State is derived from `action` + `created_at`
      alone; nothing compares the stored `rendered_business_name` to the
      concierge's CURRENT `business_name`. A coach who renames, repurposes or
      sells their setter inherits every confirmed consent given under the old
      name. The grant path checks name equality meticulously; the send path has
      no equivalent. The ledger is append-only, so a wrong-sender binding cannot
      be corrected afterwards. This is a decision, not a bug: decide it in
      step 16, not after the first send.
- [ ] **P2 — Read-then-insert on the consent ledger is not atomic.** Both
      `captureConsent` and `concierge-consent-confirm` derive state from a read
      and then insert, with no lock between. Two simultaneous confirms can file
      two `confirmed` rows (harmless: latest-wins reads them as one), and a
      withdrawal landing inside the window can be overtaken by a confirmation
      with a later timestamp. The per-recipient cooldown closes the abusive
      path; the ordering edge remains. Proper fix is one `security definer`
      function doing `insert … select … where not exists (…)` in a single
      statement.
- [ ] **P2 — `concierge_rate_limits` grows without bound on attacker-controlled
      keys.** Pre-existing: `20260625130000` defines `bucket_key text primary
      key` with no TTL and no purge job. The new `doi-ip:<x-forwarded-for>`
      bucket adds a second unbounded key space next to the existing `ip:` one.
      Both are fed by an unauthenticated endpoint.
- [ ] **P3 — The `current_setting('role')` half of the append-only trigger's
      service-role check has no test.** `concierge_consents.test.sql`
      impersonates via a JWT claim, so every service-role assertion passes
      through the `auth.role()` half. Add one assertion using `set local role
      service_role` with no JWT (the psql/SQL-editor path the comment
      describes), and bump `plan(25)` to `plan(26)`.
- [ ] **P3 — The 3-year retention purge is manual.** The consent notice AND the
      privacy page both promise three years to visitors; nothing deletes
      anything. There is no scheduler in this database on purpose. Until one
      exists, this is a promise kept by a human remembering.
- [ ] **P3 — `_shared/email.ts` logs the Resend error body on a 4xx**, which can
      echo the recipient address, while its caller is careful not to. Scrub the
      address in `redact()` or stop logging the body.

## Follow-up send path — what is built, and what is NOT (2026-08-08)

Steps 13-19 are code-complete on `feat/followup-send-path`. Two steps of the
plan are deliberately NOT done, and neither is a coding task.

- [ ] **P0 — build the reply-to verification round-trip.** `decideSend` now
      cancels every row with `reply_to_unverified` when
      `followup_reply_to_verified_at` is null, and NOTHING sets that column: the
      setup wizard deliberately does not stamp it, because a coach typing an
      address is not proof they read it. So the send path is currently a
      complete, tested machine that cancels 100% of what it claims. That is the
      right failure direction (§5 DDG wants a REACHABLE sender, and a typo means
      a customer's reply vanishes into nothing, in a mail carrying the coach's
      name) but it is a hard blocker: send one confirmation mail to the coach's
      reply-to, stamp the column when they click, or the queue never drains.
- [ ] **Step 20 — the first live fire has not happened.** Nothing in this chain
      has ever sent a follow-up. Before it can: set `RESEND_API_KEY`,
      `FOLLOWUP_FROM_DOMAIN`, `FOLLOWUP_SECRET`, `FOLLOWUP_UNSUB_SECRET`,
      `FOLLOWUP_PUBLIC_BASE_URL`, `CONSENT_CONFIRM_SECRET` and
      `RESEND_WEBHOOK_SECRET` via `supabase secrets set`; add
      `FOLLOWUP_DISPATCH_URL` + `FOLLOWUP_SECRET` to the repo's Actions secrets;
      point the Resend dashboard webhook at `resend-webhook`; then
      `update concierge_followup_ops set sending_enabled = true` and
      `FOLLOWUP_SENDING=on`, with `followup_enabled = true` on ONE
      founder-owned concierge and the founder's own address as the visitor.
      Walk the whole chain: tick, check mail, confirm, book, wait, follow-up
      arrives, click unsubscribe, re-run the tick, nothing sends.
- [ ] **Step 21 — the bot still never mentions the follow-up.** `conciergeChat.ts`
      is byte-identical to before this work: its prompt still says the setter
      "must NOT promise any follow-up". That is the correct conservative state
      until a real mail has been sent and received end to end. Nothing breaks
      without it; the mail simply arrives unannounced.
- [ ] **A registered business is required before Step 16 may run for real.**
      The dispatcher sends commercial email. §6 UWG wants the commercial
      character and the sender identifiable, and §5 DDG wants a valid Impressum
      on the sending party. Also needs an Art. 28 AVV signed with each coach,
      which needs a legal person to sign it.
- [ ] **The unsubscribe route depends on a Vercel rewrite that has not been
      exercised.** `vercel.json` now maps `/abmelden` and `/bestaetigen` to the
      two functions. Confirm both resolve in production before any mail carries
      those links, because the token module correctly refuses any host that is
      not `2fronts.de` and a broken rewrite means a dead opt-out.
- [ ] **A bounce-cancelled row can be revived by an undo click.** The undo
      migration re-queues rows guarded on `cancel_reason = 'unsubscribed'`, and
      the bounce path cancels through the same RPC, which hardcodes that reason.
      The dispatcher re-checks suppression before transmitting, so it should be
      caught there. Verify that, or give the bounce path its own cancel reason.
