# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project uses a
four-part `MAJOR.MINOR.PATCH.BUILD` version scheme.

## [1.11.0.0] - 2026-07-03

### Added
- **German SEO foundation (marketing).** Nine crawlable static pages under `public/`: Setter-Kosten-Rechner (`/rechner/`), three Ratgeber (`/ratgeber/appointment-setter-kosten/`, `/ratgeber/ki-setter-vs-mensch/`, `/ratgeber/mehr-erstgespraeche-buchen/`), three audience pages (`/fuer/coaches/`, `/fuer/berater/`, `/fuer/creator/`), plus `llms.txt`, `robots.txt`, and `sitemap.xml`. All pages carry Article/FAQPage/WebApplication JSON-LD with visible FAQ sections and brand styling.
- **Real head metadata.** `index.html` now has a descriptive title, meta description, and Open Graph tags for the AI Appointment Setter, `lang="de"`, and Organization JSON-LD. (Hardcoded canonical/og:url deliberately omitted — the SPA shell serves every route, so a static canonical would deindex deep pages.)

## [1.10.4.0] - 2026-07-02

### Changed
- **Removed the 14-day free trial.** New subscriptions are now charged the plan price immediately at checkout instead of starting a 14-day Stripe trial. Dropped `trial_period_days` from the Stripe Checkout `subscription_data` in the `create-checkout-session` edge function, so billing matches the AGB (which already describes immediate recurring billing). Existing trials already running in Stripe are unaffected; the edge function must be redeployed for this to take effect.

## [1.10.3.0] - 2026-06-29

### Added
- **Support email in the footer.** Added `support@2fronts.de` as a `mailto:` link in the shared footer (reachable from every page), with a "Support" label, a 44px touch target, an aria-label for screen readers, and DE/EN localization.

## [1.10.2.0] - 2026-06-29

### Fixed
- **Localized catalog category labels.** Category is a raw DB slug (e.g. `ki-buchung`) shared across locales, so it rendered untranslated — the English site showed the German "ki-buchung". Added a `catalog.categories` i18n map (DE + EN) and a `localizeCategory` helper, applied to the catalog badges, filter chips, and the automation detail page. English now shows "AI & Booking" / "Lead Management" / "Communication"; unknown/admin-created slugs fall back to the raw value.

### Changed
- **Thin orange rim on glass panels.** `--glass-border` is now brand orange (`#f97316` @ 55%) so the frosted glass surfaces read as on-brand highlighted panels.
- **Removed the footer "M" logo mark.** Footer now shows the "2Fronts" wordmark only (matches the header), dropping the SVG mark + its CSS.

## [1.10.1.0] - 2026-06-28

### Changed
- **Glassmorphism UI refresh.** Same warm orange palette and fonts (DM Sans + Space Grotesk), restyled as frosted glass: a reusable token set (`--glass-bg`, `--glass-bg-strong`, `--glass-border`, `--glass-blur`, `--glass-shadow`, `--glass-highlight`) in `index.css`, plus a faint fixed page-background tint so the translucent panels have something to refract. Applied to the shared `Card` and `Modal` (covers catalog, admin, and customer cards) and the landing surfaces (hero, trust cards, steps, category chips, the request box, AppHome feature/sign-in panels). Inputs stay opaque on purpose. Bundle impact is +0.24 KB gzipped, zero new requests.
- **Removed the "M" logo mark.** The header is now just the "2Fronts" wordmark; dropped the SVG mark from `AppLayout` and its CSS rule.

### Fixed
- **Undefined CSS tokens.** `index.css` now defines `--color-text-muted`, `--color-muted-foreground`, and a `--font-size-*` scale. `AppHomePage`, `AuthModal`, `ProgressBar`, and `ConciergeSetup` referenced these with no definition, so muted text and the small eyebrow/note text fell back to inherited color/size.
- **Render-blocking font load.** Moved Google Fonts (DM Sans + Space Grotesk) from a CSS `@import` to `<link rel="preconnect">` + stylesheet in `index.html`. The `@import` chained the font fetch behind the app stylesheet and blocked first paint; loading in parallel with `display=swap` cut first contentful paint from ~3.7s to ~0.4s on a local preview.
- Realigned `package.json` version (was drifted at 1.8.1.0) to match the `VERSION` file.
- **Glass hardening (pre-landing review).** Muted text darkened (`--color-text-muted` → `#6b6157`) to keep ≥4.5:1 contrast on translucent panels; added an `@supports` opaque fallback so panels stay readable where `backdrop-filter` is unsupported; moved the page-tint gradient to a fixed pseudo-element instead of `background-attachment: fixed` (avoids scroll jank with backdrop-filter); deduped the muted-color token and the hover-shadow literal.

## [1.10.0.0] - 2026-06-28

### Added
- **Localised catalog content (DE/EN).** Card name, summary and outcome description are DB data, so they previously stayed in their authored language when a visitor toggled the language. Added a `translations` jsonb column on `automations` (per-locale, human-authored overrides — no machine translation) with field-by-field fallback to the German base. Catalog and detail pages now render the active language; the admin catalog form gained EN inputs. Migration seeds English for the AI Booking Concierge and normalises its German base name.

### Changed
- **Favicon.** Replaced the off-brand purple lightning bolt with an orange (brand `#f97316`) rounded square + white check mark.

## [1.9.0.0] - 2026-06-27

### Changed
- **Launch repositioning + full public-copy rewrite.** The homepage/catalog now lead with the horizontal platform promise ("Fertige Automatisierungen, die sofort für dich arbeiten", live in under a minute), with the AI Booking Concierge as the flagship card aimed at coaches. All public copy was rewritten natively in German and English (no longer mirror-translations), em dashes removed, and the address standardised to "du" (fixing a Sie/du mix in `mapping` and `supportedSoftware`). Touches catalog, appHome, automationDetail, checkoutResult, supportedSoftware, myRequests, mapping, waitlist, catalogRequest, conciergePublic, conciergeOnboarding, conciergeSetup.

### Added
- **14-day free trial on subscription checkout.** `create-checkout-session` now sets `subscription_data.trial_period_days: 14`: the customer enters a card up front, is charged nothing during the trial, then is auto-billed at the plan price. Supports the AI Booking Concierge launch price of €99/month.

## [1.8.1.0] - 2026-06-26

### Added
- **`ADMIN_EMAIL` can list multiple recipients** (comma-separated). The request + suggestion notifications now go to all of them, so the founder can also receive at a Gmail/Google address.

## [1.8.0.0] - 2026-06-26

### Added
- **Widerrufsbelehrung page** (`/widerruf`, linked in the footer) with the statutory model withdrawal form — required now that consumers can buy subscriptions (§§ 312g, 355 BGB).

### Changed
- **Legal pass for launch.** Impressum contact updated (email `moad@2fronts.de`, phone removed). Datenschutz now discloses the AI Concierge (Google Gemini processes visitor name/email/chat; US transfer + SCCs), Resend email delivery, and the concierge/suggestion data — closing a real GDPR gap. AGB corrected to Kleinunternehmer §19 UStG (no VAT), now covers consumers + subscriptions (monthly billing, cancel to end of period via the portal) and references the withdrawal policy.

### Note
- AI-assisted legal drafting; a one-time review by a lawyer is recommended for a business taking payments.

## [1.7.0.0] - 2026-06-26

### Added
- **Subscription self-service (Stripe Billing Portal).** Subscribers can now update their card, view invoices, and cancel from "Meine Anfragen" via a "Abo verwalten / kündigen" button. New `create-portal-session` edge function (authed; resolves the Stripe customer from the caller's own provision under RLS). Required for the German Kündigungsbutton (§312k BGB) and to recover declined cards before churn.

## [1.6.0.0] - 2026-06-26

### Added
- **Admin can set monthly (subscription) pricing.** The catalog admin form now has a billing select (one-time / monthly); choosing monthly stores `pricing_model='subscription'` + `recurring_interval='month'` (the columns + subscription checkout already existed). The catalog and detail pages show "/ Monat" for subscription automations.

### Fixed
- **Automation suggestions now notify the founder.** `submit-wish` sends a best-effort Resend email to `ADMIN_EMAIL` on a new suggestion (previously it only stored a row, so suggestions never reached an inbox).

## [1.5.1.0] - 2026-06-26

### Fixed
- **Logged-in users no longer see the waitlist email/marketing form after login.** The "Nicht gefunden, was du suchst?" request capture on the catalog now drops the email field and the marketing-consent gate for signed-in users (it uses their account email); they can still suggest automations. Anonymous visitors keep the full email + DSGVO opt-in waitlist behavior.

## [1.5.0.0] - 2026-06-26

### Changed
- **Concierge captures the lead's name + email up front.** The chat now opens with a welcome and a name/email form; only after the visitor submits it does the bot lead the conversation (greets by name, asks the first qualifying question or an open lead). Contact moved from before-booking to the start.

### Added
- **Email notification to the admin on a new automation request.** A new `notify-request` edge function emails the admin (via Resend) when a customer requests an automation; `createRequest` fires it best-effort. No-ops safely until `RESEND_API_KEY` + `ADMIN_EMAIL` Supabase secrets are set.
- **Email confirmation handling in sign-up.** Sign-up now sets the confirm-link redirect and, when confirmation is pending, shows a "check your inbox" state instead of assuming the user is logged in. Works whether or not the Supabase "Confirm email" toggle is on.

## [1.4.1.0] - 2026-06-26

### Changed
- **Concierge dashboard is now a per-coach link, not a global nav tab.** Removed the global "Chats" navbar item (it doesn't scale as the app adds more products); the coach reaches the dashboard via a "Open dashboard" button on the concierge card in My Requests. The dashboard now also shows the coach's customer link(s) (`/c/<slug>`, copyable) at the top, so both links live in one place. Reading a full conversation (transcript + qualification answers) works by clicking any conversation.

### Added
- **CSV export** of all conversations from the dashboard (name, email, concierge, qualified, outcome, date, answers).

## [1.4.0.0] - 2026-06-26

### Added
- **Coach chat dashboard (`/app/chats`).** A second, authed link where the coach sees every conversation on their concierge: a list with qualified + outcome badges, click into the full transcript and the visitor's qualification answers. New owners-read RLS policy lets an owner read only their own concierge's conversations/messages (writes stay server-only).
- **Lead contact capture in the concierge chat.** Right before showing the booking link, the bot asks for the visitor's name + email via a real form (email validated); only after they submit it does the booking appear. So the coach always has a contact person + email for any lead who reaches the booking step. Name/email are stored on the conversation and shown in the dashboard.

### Fixed
- **The concierge invites the booking after the last qualifying question** instead of stopping at "thanks" (quick-reply completion now leads into the contact step, then the booking).

## [1.3.0.0] - 2026-06-26

### Added
- **Drag-and-drop reorder of the concierge's qualification questions** in the setup wizard (grip-handle drag + up/down buttons for keyboard/touch). The order sets the sequence the concierge asks them in chat, so budget no longer has to be first.

### Fixed
- **Typed answers to a qualification question are understood, not ignored.** Previously, typing (instead of clicking a quick-reply) while a question was pending was discarded — the buttons lingered and a booking button could appear alongside. Now the concierge interprets the typed text against the open question (matches an option / records it verbatim as an off-menu answer / treats a genuine question as a question), records it, and the buttons advance.

### Changed
- **UI/UX overhaul (v1.3) — elevation of the existing claymorphism.** Shared motion system (easing + duration tokens, `.rise`/`.rise-stagger` entrance utilities, reduced-motion guarded). Flagship concierge chat reworked into a delighter (clay bubbles, animated typing indicator, pill quick-replies, prominent booking CTA). Premium passes on the catalog/home, automation detail, supported-software, legal, the wizard, My Requests, the nav/footer, and the auth modal. Brand kept (warm amber + booking-blue claymorphism); WCAG AA, ≥44px targets, mobile-first.

## [1.2.1.0] - 2026-06-26

### Fixed
- **Concierge takes initiative and asks qualifying questions itself.** The prompt previously told the model not to ask qualifying questions, so the handler bolted the criterion question + buttons onto an unrelated reply (the text above the buttons read disconnected) and the bot stayed passive. Now the bot is told to lead and to ask the pending criterion in its own words; the quick-reply buttons are just the answer options (the standalone question label is gone, kept as the button group's aria-label). Button-click turns return a coherent "ack + next question" line. Leading, proactive greeting.

### Changed
- **Wizard polish.** The qualification-criteria step renders soft claymorphism cards (toggle header, editable question + option rows, "counts as qualified" toggle, compact actions). Brand-fit motion across the wizard: step rise-in, tactile hover-lift/press on choices and buttons, with a `prefers-reduced-motion` guard.

## [1.2.0.0] - 2026-06-25

### Added
- **Catalog is now the home page.** `/` serves the automation catalog (the standalone waitlist landing is gone); `/automations` stays as an alias.
- **"Didn't find what you're looking for?" capture** at the bottom of the catalog: email + free-text wish + **industry (Branche) dropdown** + an explicit marketing-consent checkbox (DSGVO active opt-in). Every submission is stored in a dedicated `wishes` table (no email dedup, so repeat requests are all kept).
- **Lead qualification for the AI Booking Concierge.** A new optional wizard step lets the coach define their ideal customer — built-in criteria (budget, industry, age, timeline+role) plus custom ones, each with answer options and a "counts as qualified" flag (`concierges.qualification_criteria`).
- **In-chat qualification.** The public concierge asks the coach's criteria as quick-reply buttons, records the visitor's answers on the conversation, and tags it qualified/not (AND rule). Hybrid: the booking link stays available to everyone — no lead is turned away.

### Changed
- Catalog request form now writes to the `wishes` table via a new `submit-wish` edge function (was the waitlist path).

## [1.1.0.0] - 2026-06-25

### Security
- **Per-IP rate limit on the public concierge chat** (`/c/<slug>`). The no-auth endpoint calls Gemini on every message; without a cap a script could run up the LLM bill. Added a Postgres fixed-window limiter (`concierge_rate_limit_hit`, 30 req/min/IP) returning HTTP 429, enforced in the DB so the count holds across stateless edge isolates. Fail-open on limiter error so a glitch never blocks a real booking. (CSO finding #1; closes the open rate-limit TODO. `supabase/functions/concierge-chat/index.ts`, migration `20260625130000`)
- **Pinned CI deploy actions to commit SHAs** — `supabase/setup-cli` and `actions/checkout` were on mutable tags while the deploy job holds Supabase secrets; pinning closes the tag-hijack supply-chain risk. (CSO finding #2; `.github/workflows/deploy-supabase.yml`)

## [1.0.6.0] - 2026-06-25

### Fixed
- **Public concierge page (`/c/:slug`) now renders standalone**, without the 2Fronts marketplace chrome (top nav with "Anmelden / Registrieren", footer). It was nested under `AppLayout`; a coach's prospect landing there saw the 2Fronts marketplace shell and an invitation to register with us instead of a clean, focused booking concierge. Moved the route out of `AppLayout` in `src/App.tsx` so the page a coach shares is bare. Regression test in `src/App.test.tsx` (standalone on `/c/:slug`, nav still present on marketplace routes). (Found via /qa on the live site.)

## [1.0.5.0] - 2026-06-25

### Fixed
- **Concierge wizard no longer shows the booking-link prompt twice.** The booking step used the same i18n string (`conciergeOnboarding.booking.title`, "Paste your booking link.") for BOTH the step heading and the input's label, so the prompt appeared twice and read as two booking-link fields. Added a distinct `conciergeOnboarding.booking.label` ("Booking link" / "Buchungslink") for the field; the heading keeps the full sentence. (`src/pages/customer/ConciergeSetupPage.tsx`, `src/i18n/locales/{de,en}.json`)

## [1.0.4.0] - 2026-06-25

### Fixed
- **No more entering your Calendly link twice when setting up the concierge.** The automation detail page showed (and required) the Twilio missed-call "business name" + "booking link" fields for *every* provisioned automation — including the AI Booking Concierge, whose calendar link is set in the setup wizard. The coach typed their Calendly at checkout (where it was discarded for non-Twilio connectors) and then again in the wizard. Those fields are now gated on `connector_type === 'twilio_missed_call'`, so the concierge (and the Sheets/Slack connectors, which configure via OAuth) no longer ask for a booking link at checkout. (`src/pages/public/AutomationDetailPage.tsx`)

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
