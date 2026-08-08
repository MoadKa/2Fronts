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

## Design System — "Der Rundgang", carried across the app 2026-08-06 (`13a1d16`)
`DESIGN.md` is binding. It documents the world that actually shipped, not an
intention: read it before any visual or UI decision. Its `name:` frontmatter is
the authoritative name of the world — trust the file over this heading.

**The home-page-only scope line is history.** `13a1d16` carried the world across
the app, so most surfaces now run `--dg-*` tokens, including the public concierge
page (`ConciergePublicPage.css` is fully migrated — verified 2026-08-08, zero old
tokens). Do not repeat the old claim that it is debt.

What is still genuinely unmigrated is narrower and worth checking per file rather
than per list: `MyRequestsPage.css` carries no `--dg-*` token at all, and a
handful of migrated files keep residual old-token usages (`CatalogPage.css`,
`ConciergeSetupPage.css`, `AppLayout.css`). Before citing any surface as
precedent or as debt, grep it — this section has been stale once already.

- `PRODUCT.md` is binding and independent: users, positioning, pricing, claim
  guardrails, evidence. Visual work must not contradict it.
- Superseded directions, kept as material only:
  `design-system/DIRECTION-nachttisch-2026-07-04.md` and
  `design-system/MASTER.md`. Do not resurrect either.
- In QA mode, flag home-page code that breaks DESIGN.md, and flag unmigrated
  surfaces as debt rather than as violations.
