## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec

## Design System — "Der Doppelgänger", home page migrated 2026-07-31
`DESIGN.md` is binding again. It documents the world that actually shipped, not
an intention: read it before any visual or UI decision.

**Mind the scope line at the top of DESIGN.md.** The world is implemented on the
home page only (`/` and `/en`, scoped to `.dg-page`), plus the global nav and
footer via a `variant='dg'` switch on those routes. Setup, chats, my-requests,
admin, automation detail and the public concierge page still run the old tokens
in `src/index.css` (Space Grotesk, DM Sans, glass, pill radii). That is recorded
debt awaiting the next migration — never cite those surfaces as precedent.

- `PRODUCT.md` is binding and independent: users, positioning, pricing, claim
  guardrails, evidence. Visual work must not contradict it.
- Superseded directions, kept as material only:
  `design-system/DIRECTION-nachttisch-2026-07-04.md` and
  `design-system/MASTER.md`. Do not resurrect either.
- In QA mode, flag home-page code that breaks DESIGN.md, and flag unmigrated
  surfaces as debt rather than as violations.
