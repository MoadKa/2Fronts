# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project uses a
four-part `MAJOR.MINOR.PATCH.BUILD` version scheme.

## [1.0.3.0] - 2026-06-25

### Fixed
- **Concierge chat no longer fails on a transient Gemini blip.** A visitor mid-conversation (e.g. asking to book) could hit "etwas ist fehlgeschlagen" when Gemini returned a transient error (429 rate-limit, 5xx overload) or a network hiccup — the handler had no retry, so a single blip became a hard error and a lost booking. The Gemini calls now retry transient failures (429/500/502/503/504 + network errors) up to 3 attempts with a short escalating backoff; a 4xx (bad key/request) still fails fast. Extracted as a shared `geminiFetchWithRetry` helper and applied to all three Gemini clients: the concierge chat (`conciergeChat.ts`), the website-import draft (`conciergeDraft.ts`), and the column mapper (`columnMapping.ts`).

## [1.0.2.0] - 2026-06-25

### Fixed
- **Concierge onboarding "import from website" now actually reads the page.** The wizard's website-import accelerator (`concierge-draft-from-url`) scraped with a plain server-side `fetch`, which returns an empty JS shell or gets bot-blocked on the site builders most coaches use (Wix/Squarespace/Framer) and behind Cloudflare — so the draft came back empty. It now scrapes via Firecrawl (renders JS, gets past bot-blocking) and returns clean markdown for the draft. Requires a `FIRECRAWL_API_KEY` secret; without it (or on any scrape failure) the wizard falls back to manual entry. (`supabase/functions/_shared/conciergeDraft.ts`)
- **No more false "draft ready" with blank fields.** `handleScrape` set the success state even when the draft was empty, so the coach saw "accept the draft" with nothing filled in. An empty draft is now treated as a failure, showing the honest "couldn't read your site, fill it in manually" note instead. (`src/pages/customer/ConciergeSetupPage.tsx`)

## [1.0.1.0] - 2026-06-25

### Fixed
- **The concierge AI no longer promises follow-ups it cannot deliver (honest handoff).** The system prompt previously told the AI, when it could not answer from the coach's content, to say it would "have {business_name} follow up" — but there is no mechanism that notifies the coach or follows up, so that was a false promise (a real visitor hit it: "let me notify company X"). The AI is now explicitly forbidden from promising any notification, callback, follow-up, or contact collection; when it cannot answer, it says so honestly and routes the visitor to the booking link (the only real next step). (`supabase/functions/_shared/conciergeChat.ts`)
- **Empty/safety-blocked model replies no longer render as a blank message.** When Gemini returns an empty response (e.g. a SAFETY finish), `generateConciergeReply` now substitutes a localized (de/en) honest fallback that points to the booking link instead of an empty bubble.
- **Booking-link detection no longer false-positives on a URL prefix.** `detectShowBooking` now requires a word boundary after the calendar URL, so a configured link that is a strict prefix of a longer URL in the reply (e.g. `.../intro` vs `.../intro-vip`) does not wrongly surface the booking CTA.

### Added
- **Public-endpoint input guards on `concierge-chat`.** Reject `message` over 2000 chars (`message_too_long`) and `session_id` over 256 chars (`session_id_too_long`) before any DB or Gemini call — bounds cost/abuse on the unauthenticated endpoint. (Closes the message-length half of the concierge cost-abuse hardening.)

### Changed
- **Race-safe conversation resolution.** `concierge_conversations` gains a `UNIQUE (concierge_id, visitor_session_id)` constraint (new migration; existing duplicates are de-duped, keeping the earliest, first), and `resolveConversation` now upserts on that constraint instead of select-then-insert. Two near-simultaneous messages on the same visitor session can no longer split the conversation history across duplicate rows.
- Concierge chat history is now fetched with a DB-side limit (most recent turns) instead of loading the whole thread and slicing in memory.

## [1.0.0.3] - 2026-06-25

### Fixed
- **Provisions never reached customers in My Requests (and Admin requests).** `automation_provisions.request_id` is UNIQUE, so PostgREST returns the `automation_provisions` embed as a single object (a to-one relationship), not an array. The UI read `request.automation_provisions[0]`, and `[0]` on an object is `undefined`, so the provision panel never rendered — meaning no concierge "Set up" button (and the Twilio number panel never showed either). Fix: `RequestService.normalizeProvisions()` coerces the embed (object | null) to an array in `listMyRequests` + `listAllRequests`. Unit tests previously mocked the embed as an array, which is why this only ever failed against live PostgREST.

## [1.0.0.2] - 2026-06-25

### Fixed
- **Concierge setup was unreachable after purchase.** The AI Booking Concierge has no OAuth step, so after payment the buyer landed on a generic "being set up" message with no way into the onboarding wizard. Now: My Requests shows a "Set up your concierge" button (→ `/connect/:provisionId/confirm`) for an unconfigured `booking_concierge` provision, and a "set up and live" note once configured. The checkout success page adds a primary "Set it up now" button to My Requests. (`AutomationProvision` type gains `connector_type` + `config`.)

## [1.0.0.1] - 2026-06-24

### Added
- **Edit existing automations in the Admin catalog.** Each listing now has an Edit button that opens an inline form (name, summary, outcome description, category, price) with Save/Cancel. Previously the Admin catalog could only create listings and toggle active/inactive — price and copy could not be changed without SQL. Connector type is intentionally not editable (changing it on a live listing would re-route its provisions).

## [1.0.0.0] - 2026-06-24

First flagship product: the **AI Booking Concierge**, built natively into the platform (epic #22).

### Added
- **AI Booking Concierge.** A coach buys it from the catalog, is walked through an Apple-style onboarding wizard, and gets a public link (`/c/<slug>`) where their audience chats with an AI that answers only from the coach's own content and books a call via the coach's calendar.
  - Runtime (#23): `concierges` / `concierge_conversations` / `concierge_messages` tables with strict RLS (the coach's offer + Q&A never reach the browser); the public `concierge-chat` edge function (multi-turn Gemini, "never invent, fall back when unsure" guardrail); the public `/c/:slug` chat page.
  - Platform buy + activate (#24): `booking_concierge` connector type + catalog SKU, provision flow, post-purchase setup via `ConnectConfirmRoute`.
  - Subscription billing (#25): Stripe `mode:'subscription'` checkout for the concierge SKU (€79/mo); webhook lifecycle (`customer.subscription.deleted` deactivates the concierge, `invoice.payment_failed` alerts). The one-time checkout path is unchanged.
  - Onboarding wizard (#26): Apple-style guided setup, one question per step, progress bar, EN/DE, with an optional "paste your website" AI-draft accelerator.

### Notes
- `concierge-chat` is public; deploy it with `--no-verify-jwt`. `GEMINI_API_KEY` is already set.
- Pilot-acceptable gaps (tracked in TODOS): the public chat endpoint has no rate limiting or message-length cap (cost-abuse risk at scale).

## [0.3.0.0] - 2026-06-23

Launch-readiness bundle for the Google OAuth review (EPIC #15).

### Added
- **Bilingual site (DE/EN) with a language switcher (#10).** Full i18n via
  react-i18next; German default, browser-detected, persisted to localStorage.
  Every page and the new footer are translation-keyed.
- **Waitlist landing + public product page (#12).** `/` is now an email-capture
  waitlist; the marketplace moved to `/automations`; a public `/app` page
  describes the product (the URL submitted to Google as the OAuth Application
  home page). New `waitlist_signups` table (RLS: service-role insert only,
  case-insensitive unique email) + `waitlist-signup` edge function.
- **Legal pages (#11).** Impressum (§5 TMG), Datenschutzerklärung (incl. the
  Google API Services User Data Policy / Limited Use clause verbatim), and a
  lean B2B AGB — all DE/EN, public, linked from the footer. Vercel disclosed as host.
- **Slack lead-notification connector — 3rd automation (#13).** OAuth v2 connect,
  channel picker, posts new leads via `chat.postMessage`. Seeded inactive until
  `SLACK_*` secrets are configured.
- **Slack channel-picker UI (#16).** `/connect/:provisionId/confirm` branches by
  `connector_type` (Google mapping vs Slack channel picker) via `ConnectConfirmRoute`.
- **CI auto-deploy for the Supabase backend.** A GitHub Action runs `db push` +
  `functions deploy` on every push to `main` touching `supabase/`, mirroring
  Vercel's frontend deploy. `verify_jwt` per function is declared in `config.toml`.

### Fixed
- **All automations are now purchasable (#13).** `automation_provisions.connector_type`
  defaulted to `twilio_missed_call` and nothing set it, so every purchase became a
  Twilio provision. Added `automations.connector_type`; `createProvisionDetails` now
  copies it onto the provision.

## [0.2.2.0] - 2026-06-22

### Security
- **OAuth connect is now CSRF-protected (#11).** The Google `state` is signed and
  bound to a per-flow nonce that oauth-start sets as an HttpOnly cookie; the
  callback requires the cookie nonce to equal the state nonce, so a connect an
  attacker started cannot be completed in a victim's browser (which would have
  stored the victim's Google token against the attacker's provision). State is
  also tamper-proof and expires after 10 minutes. Adds the `OAUTH_STATE_SECRET`
  secret.

## [0.2.1.2] - 2026-06-22

### Changed
- **Landing page translated to German.** The marketplace front door (hero, trust
  strip, how-it-works, catalog headings, empty/loading states, final CTA) is now
  German to match the connector flow and the German SMB audience. Other customer
  pages (My Requests, checkout, detail) are a follow-up pass.

## [0.2.1.1] - 2026-06-22

### Fixed
- **My Requests crashed ("Something went wrong") for any request whose automation
  can't be read.** Customers can only read `is_active=true` automations (RLS), so
  a deactivated automation makes the joined `automation` null, and
  `request.automation.requires_provisioning` threw, tripping the app-wide
  ErrorBoundary. Now guarded — a null automation renders a graceful fallback
  instead of taking the whole page down. (Surfaced by the redirect after
  confirming a mapping for a test automation that is intentionally not public.)

## [0.2.1.0] - 2026-06-22

Bug fixes found while taking the Google Sheets pipeline live end-to-end.

### Fixed
- **Mapping confirmation could never be saved.** The "Passt, los geht's" confirm
  button wrote `automation_provisions` straight from the browser, but RLS only
  permits server-side (admin) writes there — so the update was silently dropped
  and no confirmed mapping was ever persisted, leaving every lead unfilable. The
  confirm now routes through a new owner-checked `confirm-mapping` edge function
  that writes via the admin client (same pattern as `connect-configure`).
- **Catalog hung on "Loading catalog…" forever** when the automations fetch
  failed (e.g. a transient blip during deploy) — `CatalogPage` had no `.catch()`,
  so a rejected promise never cleared the loading flag. Now degrades to a "reload
  the page" message. (Released earlier on `main`; recorded here.)

## [0.2.0.0] - 2026-06-21

Connector fulfillment pipeline: the first step from "Wizard-of-Oz demand test"
toward real automated fulfillment. A connector-agnostic core, with Google Sheets
lead-filing as the first live connector.

### Added
- **Connector abstraction** (`provision` / `configure` / `run` / `connect` /
  `deprovision`) dispatched by `connector_type`. Adding a tool is adding a
  connector, not editing the orchestrator. The existing Twilio missed-call
  provisioning is reframed as a connector with no behavior change.
- **Google Sheets lead filing.** First-connect proposes an AI-assisted column
  mapping (Google Gemini `gemini-2.5-flash`) for a human to confirm; each lead is
  then filed as an append-only row aligned to the sheet's live header order.
- **Google OAuth connect flow** (`google-oauth-start` / `google-oauth-callback`):
  the OAuth `state` carries the provision id; the callback derives the owning
  customer server-side and **fails closed** on an unknown/forged provision,
  encrypts the refresh token before it touches the database, and routes the
  customer to that provision's mapping-confirmation screen.
- **Lead intake endpoint** (`intake`) plus `leads`, `connector_connections`, and
  `connector_registry` tables. The public Supported-software page and the
  customer mapping-confirmation page are driven off these.
- **The fulfillment loop now closes end-to-end** (issue #3): a real lead flows
  intake → filed row.
  - `connect-configure` edge function: the customer pastes their Google Sheet
    link, we verify they own the provision (JWT uid == provision customer),
    read the headers, propose the mapping, and store it.
  - The confirm screen's dead empty state is now a paste-a-Sheet-URL picker.
  - `intake` files each lead synchronously: it resolves the customer's confirmed
    `google_sheets` provision and runs the connector, marking the lead
    `filed` / `needs_review` / `failed`. Filing is best-effort and can never
    break intake or lose the lead.
  - `googleAuth` refreshes the stored encrypted refresh token into a live access
    token, marking the connection `revoked` on `invalid_grant`.
- **Bug fix:** the confirm screen wrote `config.confirmedMapping` but the
  connector read `config.columnMapping` — every lead would have stuck in
  `needs_review`. Both sides now use `columnMapping`.

### Security
- **F3 trust guards.** The mapper never invents a column the sheet lacks (a
  missing match becomes `null` / low-confidence); low-confidence forces a manual
  pick; writes are append-only (`INSERT_ROWS`) and verbatim
  (`valueInputOption=RAW`, so a lead value like `=...` files as text, never a
  live formula); a drifted/missing column or an incomplete lead holds in
  `needs_review` and alerts rather than writing a guess into the customer's sheet.
- Refresh tokens encrypted at rest (AES-GCM); the `encrypted_refresh_token`
  column is `REVOKE`d from client roles so `select *` can never leak it.
- The LLM API key is sent only via the `x-goog-api-key` header — never in the URL
  or request body, so it cannot land in logs.

### Known gaps
- Secrets are set on the live project and the sheet-picker/configure slice is
  done (TODOS.md #9, #10, #13 closed). Remaining before public GA: deploy the
  migration + edge functions to Supabase, OAuth `state`-signing (#11), and
  Google OAuth app verification (#12, external Google review). The live Google
  Sheets / Gemini / OAuth-exchange paths are still only exercised through test
  fakes — first real connect happens at deploy.

## [0.1.0.0] - 2026-06-20

First tagged release. Bundles the marketplace Wizard-of-Oz demand test and the
completion of the missed-call AI lead-recovery provisioning flow.

### Added
- Marketplace Wizard-of-Oz test page with a lead-capture form that posts to a
  Slack incoming webhook, for running a demand test before building fulfillment.
- Missed-call AI lead-recovery provisioning: Twilio voice and SMS webhooks, the
  `retry-provision` edge function, and supporting `automation_provisions` /
  `automation_provision_opt_outs` migrations.
- Regression test covering Twilio request-signature validation against Twilio's
  own documented worked example (previously a zero-coverage security boundary).

### Changed
- `automation_provisions.business_hours` column converted from `jsonb` to `text`
  to match every app-layer consumer (no production data affected).

### Fixed
- **STOP opt-outs were ignored.** The missed-call SMS sender (twilio-voice-webhook)
  never checked the opt-out table, so a caller who texted STOP could still be
  messaged — a TCPA/anti-spam compliance gap. Now enforced before every send.
- Opt-out insert errors in twilio-sms-webhook were silently swallowed; failures
  are now surfaced via `console.error`.
- `booking_link` is now validated at the database layer (`https?://`, max 200
  chars) since it is echoed verbatim into SMS sent to third parties and RLS only
  checked ownership, not content.
- twilio-voice-webhook no longer sends the missed-call SMS for non-active
  provisions.
- The missed-call edge-function test suite never actually ran (26 errors); the
  suite now executes and passes.
- QA fixes: catalog no longer shows empty when the demo automation is
  deactivated (ISSUE-001); the Slack capture payload no longer rejected with
  `400 no_text` (ISSUE-002); the "automation of interest" field now guides
  direct visitors (ISSUE-003).

### Known gaps
- No expiry/cleanup for abandoned-checkout `automation_provisions` rows stuck in
  `pending` (tracked in TODOS.md #8).
