# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project uses a
four-part `MAJOR.MINOR.PATCH.BUILD` version scheme.

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
