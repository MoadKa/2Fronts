# TODOS

Reorganized 2026-07-12 by `/ship` into the gstack canonical format (component
groupings, P0-P4 priority, dedicated Completed section). Content preserved
verbatim from the original captures — only structure changed.

## Missed-Call Recovery (Twilio)

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
