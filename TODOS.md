# TODOs

Captured during /plan-eng-review (2026-06-20) for the AI-built missed-call lead recovery feature. See the design doc at `~/.gstack/projects/MoadKa-2Fronts/akaou-main-design-20260620-132616.md` for full context.

## 1. Number-recycling / deprovisioning lifecycle

**What:** Design what happens to a cancelled customer's Twilio number once Twilio eventually releases and reassigns it to someone else.

**Why:** A stale `automation_provisions` row could route a new customer's calls using old config, or the unique constraint on `twilio_phone_number` could block reprovisioning a recycled number entirely.

**Pros:** Prevents a real production bug (misrouted SMS/calls) once any customer ever cancels.

**Cons:** No customer has cancelled yet — designing this now is speculative without a real case to design against.

**Context:** Current schema has a `cancelled` status on `automation_provisions` but no release/cleanup logic tied to it. Flagged by the outside-voice review during /plan-eng-review, not caught by the initial architecture review.

**Depends on:** Nothing blocking — can be designed anytime, but no urgency until customer #1 actually cancels.

## 2. Active failure alerting (email/Slack) on provisioning failure

**What:** Push a notification (email or Slack webhook) when `automation_provisions.status` flips to `failed`, instead of relying on someone checking `AdminRequestsPage`.

**Why:** A paid customer with a silently-failed provision and no one watching the admin panel is a refund-support incident with no defined owner.

**Pros:** Closes the "silent failure" gap explicitly named in the design doc's Failure Modes section.

**Cons:** Extra integration (email/Slack webhook) for a feature currently serving exactly one pilot customer, who will likely be watched closely anyway.

**Context:** v1 persists `status: 'failed'` and surfaces it in the UI (Issue 7 of the eng review), but nothing actively pushes a notification.

**Depends on:** Nothing — needed before scaling past one customer, not before pilot launch.

## 3. Per-tenant carrier registration for future market expansion (e.g. US 10DLC)

**What:** Investigate whether carriers require per-business (not platform-level) registration for SMS sending if/when expanding beyond Germany — e.g. US 10DLC brand/campaign registration is likely per-business.

**Why:** The "one platform Twilio credential" architecture (Issue 1) assumes platform-level is sufficient. That may not hold in every market.

**Pros:** Avoids re-architecting credential storage mid-expansion if discovered too late.

**Cons:** Explicitly out of scope for the Germany-first pilot — investigating now is premature.

**Context:** Outside-voice review flagged this during /plan-eng-review. Germany-specific dependencies (already added to the design doc) cover the current market; this TODO is purely about future expansion.

**Depends on:** A decision to expand beyond Germany.

## 4. "AI" marketing framing vs. fixed-template reality

**What:** Decide how to position the product given v1's actual mechanism is a fixed 3-field SMS template with zero LLM inference, while the target customer's mental model and the product's own framing is "AI."

**Why:** Named competitors (Aira, Allo) may offer real conversational AI texting. If a customer or competitor comparison reveals v1 is a static template, that's a credibility risk against the "AI-built" framing the whole go-to-market plan relies on.

**Pros:** Resolving this deliberately (rather than by default) avoids an awkward mismatch between marketing copy and actual product behavior at launch.

**Cons:** Pure product/positioning decision — no code changes resolve it either way.

**Context:** Flagged by the outside-voice review during /plan-eng-review. Doesn't block any engineering work in this plan.

**Depends on:** Nothing — should be resolved before marketing copy/pricing page goes live, not before engineering starts.

## 5. Resolve whether a Gewerbe (business registration) is needed to legally invoice/accept payment in Germany

**What:** Get a real answer (Steuerberater or Anwalt, not this codebase) on whether the founder needs to register a business to legally sell automations and accept payment via Stripe in Germany, independent of which country issues the Twilio phone number.

**Why:** The provisioning architecture was switched to Finnish (+358) numbers specifically to avoid Twilio's German number-assignment requirement (a BNetzA telecom rule), which is unrelated to whether operating the business itself requires registration. That second question was never resolved — it was explicitly deferred, not answered, when the Finnish-number decision was made (2026-06-20).

**Pros:** Closes a real legal exposure gap before real money changes hands with a real customer.

**Cons:** Not an engineering task — needs professional advice, not code.

**Context:** Surfaced during the Twilio provisioning country decision. The Finnish-number switch is a legitimate technical choice (sidesteps Twilio's number-specific KYC) but explicitly does not answer this separate question.

**Depends on:** Nothing blocking engineering work, but should be resolved before the first real customer pays.

## 6. Promote the marketplace Wizard-of-Oz capture-form relay into the real customer-intake mechanism, if the test validates

**What:** If the marketplace Wizard-of-Oz demand test (see `/office-hours` design doc `akaou-main-design-20260620-185237.md` and `/plan-ceo-review` CEO plan `2026-06-20-marketplace-wizard-of-oz-test.md`) produces a go signal, reuse the throwaway capture-form's relay edge function as the seed of the real customer-intake mechanism for Approach B (the full dev-upload platform), instead of rebuilding intake from scratch.

**Why:** The relay function (capture form → server-side secret → webhook/email) already works once built for the test; rebuilding the same capability later would be pure waste if the underlying idea validates.

**Pros:** Near-zero extra cost — direct reuse of code that already exists and already works.

**Cons:** Purely conditional. If the test produces a kill signal instead, this TODO is dead weight and should be deleted, not carried forward indefinitely.

**Context:** Surfaced during `/plan-ceo-review`'s Section 6/Test review pass on the Wizard-of-Oz test plan. Only actionable once the test concludes with a go signal (Success Criteria: 2-3 owners complete real integration setup and keep using it for a week, AND the named developer ships a working listing unprompted).

**Depends on:** The Wizard-of-Oz test's go/kill outcome (not yet known — test hasn't run).

## 7. Consider a downloadable local agent as the universal integration mechanism for Approach B

**What:** Instead of building a bespoke API integration per customer's CRM/website (which doesn't scale — every business uses a different tool), investigate a small downloadable local agent (e.g. a lightweight Electron/Tauri app, or even a simple scheduled script) that runs on the customer's own machine and performs the automation locally, without needing per-target API integration work.

**Why:** Surfaced during `/plan-eng-review`'s outside-voice pass on the Wizard-of-Oz test plan, in response to the founder asking whether a downloadable app could be a fallback when a business's tool has no usable API. This could be the mechanism that makes Approach B (the real dev-upload platform) tractable instead of an integration-per-target nightmare.

**Pros:** Sidesteps the "every business uses a different CRM" scaling problem entirely — one generic agent instead of N bespoke integrations.

**Cons:** Asking a stranger to download and run unsigned/unknown code on their business PC is arguably a bigger trust ask than OAuth-style permissions to a known CRM, not a smaller one — this needs real thought before assuming it's the easier path. Also nontrivial to build (cross-platform packaging, distribution, trust/signing) — wrong-sized for this week's throwaway test, which is why it was deferred rather than built now.

**Context:** Not relevant to the current Wizard-of-Oz test (explicitly rejected as over-scoped for testing with one customer this week — see the design doc's Assignment, which uses a feasibility check + hand-built per-customer script instead). Only relevant if/when Approach B gets greenlit.

**Depends on:** A go signal from the current Wizard-of-Oz test, and a decision to actually build Approach B.
