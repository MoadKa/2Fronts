# 2Fronts Design System — "Apple in Orange"

Source of truth for visual decisions. Tokens live in `src/index.css`; this file
explains the intent behind them. The 7 static SEO pages under `public/` carry
inline copies of these values and must be updated in lockstep.

## Design language

Apple's marketing-site discipline, with orange doing the job Apple gives blue.
White pages, near-black ink, one accent spent deliberately. Typography carries
the design; decoration is subtracted until what remains looks inevitable.

**North stars:** apple.com section rhythm, typography-led heroes, bento tiles.
**Explicitly rejected:** gradient blobs, colored glass rims, clay/offset shadows,
boxed heroes, orange washed across backgrounds, purple/blue gradient "AI" look.

## Color

| Role | Token | Value | Rule |
|---|---|---|---|
| CTA fill | `--color-primary` | `#ea580c` | Buttons, active chips. White text. |
| CTA hover | `--color-primary-dark` | `#c2410c` | |
| Brand highlight | `--color-secondary` | `#f97316` | Decorative only (logo, selection, faint hero tint). Never text on white. |
| Links | `--color-accent` | `#c2410c` | 4.5:1 on white — safe at body size. |
| Page | `--color-background` | `#ffffff` | |
| Alt section / tile | `--color-surface-alt` | `#f5f5f7` | Alternate sections and quiet tiles (Apple gray). |
| Headings | `--color-foreground` | `#1d1d1f` | |
| Body | `--color-text` | `#3a3a3c` | |
| Secondary text | `--color-text-muted` | `#6e6e73` | Min size 0.85rem. |
| Divider | `--color-border` | `#d2d2d7` | Form borders, rules. |
| Card edge | `--color-hairline` | `rgba(0,0,0,0.08)` | 1px card borders. |

**The orange budget:** per screen, orange appears on (1) the primary CTA,
(2) links, (3) at most one highlight (eyebrow, icon, active state). If orange
is everywhere, it is nowhere.

## Typography

DM Sans (body) + Space Grotesk (headings) — unchanged, loaded via `<link>` in
`index.html`. Display type is big, tight, confident:

- h1: `clamp(2.25rem, 1.4rem + 3.4vw, 3.5rem)`, weight 700, tracking −0.03em, leading 1.08
- h2: `clamp(1.6rem, 1.2rem + 1.6vw, 2.25rem)`, tracking −0.02em
- Body 16px/1.6; secondary text `--color-text-muted`

## Shape & elevation

- Radii: 12 / 16 / 20 / 28px (`--radius-sm/md/lg/xl`); buttons and chips are
  pills (`--radius-pill: 980px`).
- Shadows are whispers, neutral black alphas: `--shadow-sm/md/lg`. The old
  `--shadow-clay-*` names alias to these; don't use them in new code.
- Cards: white, 1px hairline, `--shadow-sm`, hover lift ≤3px + `--shadow-md`.
- Quiet tiles (trust items, steps, feature grids): flat `--color-surface-alt`,
  no border, no shadow, hover lift 2px.

## Glass

Reserved for two surfaces only: the sticky nav and modal overlays.
`--glass-bg-strong` + `blur(20px) saturate(180%)` + neutral hairline. Content
cards are never glass. Modal scrims: `rgba(0,0,0,0.4)` minimum.

## Motion

Tokens: `--dur-fast 140ms / --dur-base 240ms / --dur-slow 400ms`,
`--ease-out / --ease-spring`. Entrances rise 12px + fade (`.rise`,
`.rise-stagger`, 40ms cascade). Buttons scale 0.97 on press. Everything
respects `prefers-reduced-motion`. Nothing animates that doesn't communicate.

## Voice constraints (from branding sessions)

German-first, native tone, no dashes in copy. Copy changes are marketing's
lane — design work must not alter strings.
