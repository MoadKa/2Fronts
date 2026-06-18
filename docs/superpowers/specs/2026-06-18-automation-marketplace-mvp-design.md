# 2Fronts Automation Marketplace — MVP Design

## Context

2Fronts is pivoting from a German influencer-marketing SaaS (the existing `CIStudiov3` codebase, left untouched on disk as historical reference) to an "App Store for business operations": a marketplace where businesses discover, request, pay for, and receive business-process automations.

Strategy driving this design (per YC-style plan): validate demand before building broadly, ship the smallest usable product, get paying customers, then iterate. The catalog must stay **category-agnostic in code** — no vertical (e.g. "customer support automation") is hardcoded. The wedge is a content/data decision made later, not a code change.

This is a fresh repository (`2Fronts-marketplace`), reusing only domain-agnostic pieces from `CIStudiov3` (UI kit components, Supabase/Stripe integration patterns). All influencer-marketing domain logic (campaigns, contracts, brand/creator/gatekeeper/moderator roles, three-column layout) is left behind, not ported.

## Out of scope (explicitly excluded from MVP)

- Builder/seller accounts — only 2Fronts (admin) populates the catalog.
- Ratings and reviews.
- Subscriptions or complex multi-party billing — one-time Stripe Checkout payment per request only.
- AI-generated automations or automated deployment/installation — fulfillment is manual (admin marks status, adds delivery notes).
- Multi-seat teams / organizations — one user account per business for MVP.

## Architecture

- **Frontend**: React + Vite + TypeScript SPA.
- **Backend**: Supabase (Postgres + Auth + Row Level Security). No custom backend server.
- **Payments**: Stripe Checkout for one-time payments. A Supabase Edge Function receives the Stripe webhook and updates request status to `paid`.
- **Hosting**: Frontend deployable as a static build (Vercel or similar); Supabase hosted backend. Deployment target finalized during implementation, not blocking design.

## Data model

All tables use Supabase RLS so customers only see their own requests; admins see everything.

```
profiles
  id (uuid, fk auth.users)
  role            text  -- 'customer' | 'admin'
  company_name    text
  email           text

automations
  id                  uuid
  name                text
  summary             text
  outcome_description text
  category            text   -- free-text tag, never an enum/hardcoded list
  price_cents         integer
  currency            text default 'eur'
  is_active           boolean default true
  created_at          timestamptz

automation_requests
  id                          uuid
  automation_id               fk automations
  customer_id                  fk profiles
  status                      text  -- 'requested' | 'payment_pending' | 'paid' | 'in_progress' | 'delivered' | 'cancelled'
  stripe_checkout_session_id  text nullable
  delivery_notes              text nullable
  requested_at                timestamptz
  paid_at                     timestamptz nullable
  delivered_at                timestamptz nullable
```

`category` being a plain text column (not an enum or foreign key to a hardcoded list) is the mechanism that keeps the catalog category-agnostic.

## Core user flows

### Customer
1. Browse the public catalog (no login required) — list of active automations with name, summary, category, price.
2. View an automation's detail page (outcome description, price).
3. Click "Request this automation" — prompted to sign up/log in if not authenticated (Supabase email/password auth).
4. Confirm request, redirected to Stripe Checkout.
5. After successful payment, webhook flips request to `paid`; customer lands on "My Requests" showing status.
6. Customer can return to "My Requests" any time to see status progress and, once `delivered`, the delivery notes left by admin.

### Admin
1. Log in with `role = admin`.
2. CRUD the automations catalog (create, edit, activate/deactivate). No deletion of automations with existing requests — deactivate instead.
3. View all requests across all customers, filterable by status.
4. Manually advance a request's status (`paid` is set automatically by webhook; `in_progress` → `delivered` are manual) and attach delivery notes.

## Reused vs. new (relative to CIStudiov3)

**Reused (ported, domain-agnostic only)**:
- UI kit: `Button`, `Card`, `Modal`, `Badge`, `Input`, `Toast`, `ErrorBoundary` (component + CSS pairs).
- Supabase client setup pattern and `AuthContext`/`ProtectedRoute` structure (rewritten against the new schema/roles, not copied verbatim).
- Stripe Checkout + webhook Edge Function pattern.

**Not reused (left in CIStudiov3, not rebuilt)**:
- `ThreeColumnLayout`, `SidebarLeft`/`SidebarRight` — replaced by a simple top-nav layout suited to a catalog browsing experience.
- All campaign/contract/application services and brand/creator/gatekeeper/moderator pages.

## Testing strategy

- Vitest for unit tests on services and components (mirrors CIStudiov3's existing setup).
- Playwright for one golden-path e2e test: browse catalog → request automation → pay via Stripe test mode → admin marks delivered → customer sees delivered status and notes.

## Git / delivery workflow

- `main` is the protected trunk; no direct commits to it.
- One feature branch per user story. Each branch goes through: implement (TDD) → open PR → review by an independent code-reviewer agent → address feedback → merge → delete branch.
- Stories that don't share files can be implemented in parallel (separate worktrees/subagents); stories touching the shared schema (migrations) are sequenced first.

## Proposed user-story sequence

1. **Scaffold** — Vite+React+TS project, Supabase project wiring, base DB migration (all three tables + RLS policies), ported UI kit, base routing/layout. (Foundation — not parallelizable.)
2. **Auth & roles** — signup/login/logout, `profiles` row creation, `ProtectedRoute`, customer vs admin gating. (Depends on 1.)
3. **Public catalog browse + detail** — list and detail pages reading `automations`. (Depends on 1.)
4. **Request + Stripe Checkout** — request creation, Checkout session, webhook handling status transitions through `paid`. (Depends on 2, 3.)
5. **Customer "My Requests" dashboard** — list of the logged-in customer's requests with status and delivery notes. (Depends on 4.)
6. **Admin catalog CRUD** — create/edit/activate/deactivate automations. (Depends on 2.)
7. **Admin request management** — list all requests, filter by status, advance status, add delivery notes. (Depends on 4, 6.)

Stories 3 and 6 can run in parallel once 1 and 2 are merged. Story 7 depends on both 4 and 6 landing first.
