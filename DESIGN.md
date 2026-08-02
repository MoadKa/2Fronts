---
name: Der Rundgang
description: A small exhibition — oxblood walls where a Rousseau hangs, linen floors where the business is done.
colors:
  crimson: "#6e1f24"
  crimson-deep: "#5a171c"
  bone: "#f2e3d5"
  bone-2: "#d6bfae"
  lamp: "#d2a244"
  lamp-deep: "#9c7420"
  plaster: "#e7dfd0"
  plaster-2: "#f3ede1"
  plaster-line: "#cec2ad"
  night: "#17130f"
  night-2: "#201a15"
  night-line: "#332a22"
  night-ink: "#f2ece2"
  night-ink-2: "#a89b8a"
  ink: "#17130f"
  ink-2: "#56503f"
  loss: "#b8412e"
typography:
  display:
    fontFamily: "Familjen Grotesk, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(2.2rem, 1.2rem + 3.3vw, 4rem)"
    fontWeight: 700
    lineHeight: 1.04
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Familjen Grotesk, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(1.9rem, 1.3rem + 2vw, 3rem)"
    fontWeight: 700
    lineHeight: 1.04
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Familjen Grotesk, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 1.2rem + 1vw, 2.1rem)"
    fontWeight: 700
    lineHeight: 1.04
    letterSpacing: "-0.03em"
  price:
    fontFamily: "Familjen Grotesk, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(2.4rem, 2rem + 2vw, 3.4rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontFeature: "tabular-nums"
  entrance-sub:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(1.02rem, 0.96rem + 0.3vw, 1.15rem)"
    fontWeight: 400
    lineHeight: 1.6
  section-title:
    fontFamily: "Familjen Grotesk, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(1.35rem, 1.1rem + 0.9vw, 1.85rem)"
    fontWeight: 700
    lineHeight: 1.04
    letterSpacing: "-0.03em"
  lead:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(1.05rem, 0.98rem + 0.35vw, 1.25rem)"
    fontWeight: 400
    lineHeight: 1.6
  micro:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "0.7rem"
    fontWeight: 400
    note: "Timestamps inside the drawn phone only. Not a step of the page's ramp."
  body:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "1.08rem"
    fontWeight: 400
    lineHeight: 1.6
  label-title:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "1.08rem"
    fontWeight: 400
    fontStyle: "italic"
  label-meta:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 400
    letterSpacing: "0.02em"
  measure:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 600
    letterSpacing: "0.08em"
    fontFeature: "tabular-nums"
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.85rem"
    fontWeight: 400
    note: >-
      The only monospace in the world, and the only place it may appear: the
      embed snippet the coach copies into their own site. Code, not a technical
      costume. Times and prices stay in Archivo with tabular figures.
rounded:
  none: "0"
  device-body: "42px"
  device-rail: "41px"
  device-screen: "33px"
  device-chip: "12px"
  device-tile: "16px"
  device-button: "2px"
  device-pill: "999px"
  note: >-
    The world has no radius: every wall, pane, label and button is a hard edge.
    The device values exist only inside Room II's drawn phone, where they are
    the proportions of a physical object rather than a brand shape. Nothing
    outside that phone may use them.
spacing:
  gutter: "clamp(1.25rem, 4vw, 4rem)"
  room: "clamp(4.5rem, 11vh, 9rem)"
  entrance: "clamp(3.5rem, 9vh, 6.5rem)"
  pane: "clamp(1.1rem, 2.5vw, 1.75rem)"
  card: "clamp(1.5rem, 3vw, 2.5rem)"
components:
  button-lamp:
    backgroundColor: "{colors.lamp}"
    textColor: "{colors.night}"
    typography: "{typography.title}"
    rounded: "{rounded.none}"
    padding: "0.85rem 1.6rem"
    height: "52px"
  button-lamp-hover:
    backgroundColor: "{colors.lamp}"
    textColor: "{colors.night}"
  button-outline-night:
    backgroundColor: "transparent"
    textColor: "{colors.night-ink}"
    rounded: "{rounded.none}"
  button-outline-night-hover:
    backgroundColor: "{colors.night-2}"
    textColor: "{colors.lamp}"
  button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.plaster-2}"
    rounded: "{rounded.none}"
    height: "48px"
  button-ink-hover:
    backgroundColor: "{colors.ink-2}"
    textColor: "{colors.plaster-2}"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.none}"
    padding: "0.5rem 0.9rem"
    height: "44px"
  chip-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.plaster}"
  input-field:
    backgroundColor: "{colors.plaster}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0.65rem 0.9rem"
    height: "48px"
  card-pane:
    backgroundColor: "{colors.plaster-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "{spacing.pane}"
  room-wall:
    backgroundColor: "{colors.crimson}"
    textColor: "{colors.bone}"
    padding: "{spacing.room}"
  room-floor:
    backgroundColor: "{colors.plaster}"
    textColor: "{colors.ink}"
    padding: "{spacing.room}"
---

# Design System: Der Rundgang

**Scope (widened 2026-08-02).** This system describes **the whole React application**. Its tokens are declared at `:root` in `src/index.css`, and the app's older token names (`--color-*`, `--radius-*`, `--shadow-*`, `--glass-*`, `--sans`, `--heading`) are remapped there onto this world, so a stylesheet that still asks for `--color-surface` gets plaster and one that asks for `--radius-lg` gets zero. Space Grotesk and DM Sans are gone from the app, along with the glass layer, the blur, the pill radii and the orange accent.

Two things stay outside this scope:

- The **standalone HTML pages under `public/`** — the segment landing pages (`/fuer/*`), the guides (`/ratgeber/*`), the calculator (`/rechner/`), and the sales demo artifacts. They are separate documents with their own `<head>` and their own inline CSS, and they still carry the retired "Apple in Orange" palette. Recorded debt, not precedent.
- The exhibition's **staging** — see the split below.

**The material / staging split.** The whole app shares this world's *material*: the two faces, the palette and its status ramps, zero radius, flat surfaces separated by ground changes and hairlines, the drawn focus rectangle, the five-step body ramp, tabular figures for times and prices, and the component specs below.

The exhibition's *staging* belongs to the home page alone: rooms, wall/floor alternation, full-bleed grounds, the hung works and their wall labels, the vitrine, the touchable exhibit, and the fluid `clamp()` heading sizes. A wall is read at arm's length and grows with the viewport; a wizard step, a chat list and an admin table are read at a fixed desk distance inside a column that does not grow, where a fluid heading only wobbles between breakpoints.

**Work surfaces** (`--op-*` tokens) therefore take:

- **Fixed heading steps** at a 1.2 ratio — `--op-h1: 1.75rem`, `--op-h2: 1.45rem`, `--op-h3: 1.2rem` — because these screens carry far more type elements than a room does and exaggerated contrast becomes noise.
- **`--op-pane-pad`** for panes, and the ordinary `--space-*` scale for rhythm, not `--dg-room`.
- **One lamp per view, on the action the visitor came to take.** The rule is unchanged, only re-scoped: on the home page that is three lamps across nine rooms, in a wizard step it is one. Everything else is an outline (`.btn-secondary`) or a form's own solid submit (`.btn-ink`).
- **The full state vocabulary** — default, hover, focus, active, disabled, loading, error, empty. The exhibition needs almost none of these; a tool needs all of them.

Two tokens were added when the world moved into the app, both drawn from existing ramps rather than invented: `--dg-lamp-tint` / `--dg-lamp-ink` for notice and warning states, which the exhibition never needed because it never had to warn anyone.

**One monospace exists**, and only one: the embed snippet in `ConciergeEmbedSection` (`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`). It is a script tag the coach copies into their own site, where character-for-character legibility and a stable column are the whole job. This is the single exception to "there is no monospace in this world" — it is code, not a technical costume, and nothing else may reach for it.

## Overview

**Creative North Star: "Der Rundgang" — the walk-through**

The home page is a small exhibition. The visitor enters through a panel by the door, then walks a sequence of rooms that alternate between two grounds: a **wall** of deep oxblood where a real Henri Rousseau painting hangs with a real museum label, and a **floor** of warm linen plaster where the product's business is done — the vitrine, the touchable exhibit, the setup steps, the price, the collection, the wish form. Look at something, then read something. That alternation is the pacing, and it is the central rule of the system. The walk ends in night: a dark closing room and a footer in the same night, so the visitor leaves the building rather than falling off the page.

The material vocabulary is a gallery's, not a SaaS product page's: hard edges everywhere, hairline borders, no radius on any wall, pane, label or button, and a change of ground rather than a card shadow to signal that a new thing has begun. The single exception is the drawn phone in Room II, whose corners are the proportions of a physical object rather than a brand shape. Every neutral is warm on purpose. Oxblood is an earth red, and a cool grey set beside it reads as dirt rather than as contrast, so the whole family — plaster, bone, ink, night — was warmed to sit with it. Motion is one authored moment and nothing else: the works drift against the scroll the way a picture on a wall does when you walk past it. A scroll-driven blur on the paintings was written and then removed because it cost a full-size repaint per frame and would have left artwork permanently blurred wherever `animation-timeline: view()` is unsupported.

The paintings are load-bearing, not decoration. Three public-domain Rousseau works are downloaded into `public/art/` and served locally, each hung by the `Work` component with a full catalogue label — artist, title, year, medium, collection, public-domain rights — and only then, below a hairline rule, our own interpretive line. The direction contract still recorded in `index.html` is now **partly historical**: its THESIS and FIRST VIEWPORT blocks describe a superseded arrangement of a split seam and a doubled, mid-sentence-clipped headline that no longer exists anywhere in the code. FORM's seed (`8ad6b237`, magical realism) is kept as provenance; the page's thesis is now the walk.

**Key Characteristics:**
- Wall / floor alternation as the page's structural rhythm and its only pacing device
- One warm colour family; every neutral warmed to sit with oxblood
- Zero border radius; hairline borders and ground changes carry all structure
- Real artworks with real museum labels, catalogue facts before interpretation
- One lit thing on the page: the lamp CTA
- Stillness — no entrance animation, no scroll effects

## Colors

One warm family, top to bottom: an earth-red wall, a linen floor, a night that closes the room, and a single lit yellow.

### Primary
- **Oxblood Wall** (`crimson`): the hanging wall. It owns whole rooms as a full-bleed ground, never a tint and never a small accent block. It also sets the step numerals, the checklist tick, and the field focus border on the floor.
- **Oxblood Deep** (`crimson-deep`): the default focus-ring colour across the page — the deeper shade of the same wall.

### Secondary
- **Lamp Yellow** (`lamp`): the only lit thing in the building, therefore the only filled button. It appears on the trial CTA and as the hover/active ink for navigation and footer links against night. Nothing else is ever filled with it.
- **Lamp Deep** (`lamp-deep`): the 1px edge of the lamp button, so even the lit surface has a drawn boundary.

### Tertiary
- **Loss Red** (`loss`): failure only — the wish form's error text and the edge of the unread state marker. Never decorative, never a heading colour.

### Neutral
- **Linen Plaster** (`plaster`): the floor. The page background and the ground of every non-wall room, plus the fill of nested message blocks and form inputs.
- **Raised Plaster** (`plaster-2`): the lighter linen one layer up — vitrine panes, the offer card, the setter frame, the wish-form band, and the collection row hover.
- **Plaster Line** (`plaster-line`): the hairline that divides the floor world — room edges, pane borders, list rules, input strokes.
- **Ink** (`ink`): primary text on the floor, and the fill of the dark form button and the active chip.
- **Ink Muted** (`ink-2`): secondary prose on the floor — sub-leads, body under a bold lead-in, bullet text, notes.
- **Night** (`night`): the closing room, the buy panel of the offer card, the navigation bar, and the frame around every painting.
- **Night Raised** (`night-2`): the footer ground and the hover fill of outline nav buttons — one step up from night without leaving it.
- **Night Line** (`night-line`): the hairline in the dark — nav and footer edges, language-switcher borders, outline-button strokes.
- **Night Ink** (`night-ink`) / **Night Ink Muted** (`night-ink-2`): the two inks used ON night. Primary carries headings, the price, brand and nav links; muted carries supporting copy, rights lines and the price unit.
- **Bone** (`bone`) / **Bone Muted** (`bone-2`): the two inks used ON the wall. Bone carries the entrance headline, the label's artist and title lines, and our interpretive note; bone-muted carries the label metadata and the entrance sub-lead.

### Named Rules
**The Warm Family Rule.** Every neutral in this world is warm. Oxblood is an earth red, and a cool grey beside it reads as dirt rather than as contrast. Never introduce a blue-grey, a pure `#000`, or a pure `#fff`; take the neutral from the plaster, bone, ink or night ramp instead.

**The One Lamp Rule.** Lamp yellow fills exactly one control per page — the trial CTA. Every other action is an outline (in the night chrome) or ink-filled (on the floor). If a second yellow button appears, one of them is wrong.

**The Two Inks Per Ground Rule.** Each ground carries exactly two inks, one primary and one muted: bone / bone-muted on the wall, ink / ink-muted on the floor, night-ink / night-ink-muted on night. A third opacity step is not available — if text needs to recede further than muted, it does not belong on that ground.

## Typography

**Display Font:** Familjen Grotesk (weights 500/600/700; fallback Segoe UI, system-ui, sans-serif)
**Body Font:** Archivo (weights 400/500/600; fallback Segoe UI, system-ui, sans-serif)
**Label/Mono Font:** none. There is no monospace in this world; times and prices are set in Archivo with tabular figures.

**Character:** A tight, slightly condensed grotesque over a plain workhorse sans — signage over wall text. Headings are heavy and negatively tracked so they read as cut lettering; running copy stays quiet and unmannered so the paintings and the one number do the talking.

### Hierarchy
- **Display** (Familjen Grotesk 700, `clamp(2.2rem, 1.2rem + 3.3vw, 4rem)`, 1.04, -0.03em): the entrance panel's single H1, capped at 20ch and balanced. The ceiling is 4rem rather than a larger one so the headline, its sub, the CTA, the payment terms and the evidence line all clear the fold together.
- **Headline** (Familjen Grotesk 700, `clamp(1.9rem, 1.3rem + 2vw, 3rem)`, 1.04): every room's H2, including the closing room.
- **Title** (Familjen Grotesk 700, `clamp(1.5rem, 1.2rem + 1vw, 2.1rem)`): the offer card's H3. Smaller display-face lead-ins descend from the same face — step titles (1.12rem), fact and row headings (1.08–1.15rem), pane and setter-bar labels (0.95rem at weight 600).
- **Price** (Familjen Grotesk 700, `clamp(2.4rem, 2rem + 2vw, 3.4rem)`, line-height 1, tabular figures): the one number on the page, set on night. Its unit rides along at 1rem weight 500 with tracking reset to 0.
- **Lead** (Archivo 400, `clamp(1.05rem, 0.98rem + 0.35vw, 1.25rem)`, 1.6): the entrance sub-lead, capped at 50ch.
- **Body** (Archivo 400, 1.08rem, 1.6): room sub-leads and closing prose, capped at 62ch. Default paragraph line-height across the world is 1.6.
- **Label Title** (Archivo 400 italic, 1.08rem): the artwork title inside a wall label — the only italic in the system that carries meaning rather than tone.
- **Label Meta** (Archivo 400, 0.85rem, 0.02em): catalogue metadata and rights lines.
- **Measure** (Archivo 600, 0.85rem, 0.08em, tabular figures): clock times and the setter's live/off readout.

### Named Rules
**The Measurement Rule.** Times and prices are measurement, so they are set as measurement: `font-variant-numeric: tabular-nums`, one width per digit, tracked out at 0.08em for clocks. Never soften a time into prose ("spätabends"), and never let a price reflow its digit widths.

**The Two Faces Rule.** Familjen Grotesk sets headings, numerals, buttons and short structural labels; Archivo sets everything a visitor reads as a sentence. There is no third face and no monospace. A label that wants to look technical gets tabular figures and tracking, not a mono stack.

**The Measure Cap Rule.** Reading columns are capped in `ch`, not px: 18ch for the display headline, 50–52ch for leads, labels and notes, 62ch for body prose, 54ch for the closing panel.

## Layout

The page is a vertical sequence of full-bleed **rooms**. The app shell's max-width and padding are explicitly cancelled under this page (`.app-main:has(.dg-page)`), because a wall that stops short of the viewport edge is a poster, not a wall. Inside each room, content is re-centred by a shell of max-width 1240px with a fluid gutter (`clamp(1.25rem, 4vw, 4rem)`). The footer aligns to the same 1240 measure via `padding-inline: max(gutter, calc(50vw - 620px))`, so the chrome sits on the same column as the exhibition.

Vertical rhythm comes from one room token (`clamp(4.5rem, 11vh, 9rem)`) applied top and bottom to every room, to the closing room, and to the wish-form band. The entrance panel breathes slightly less (`clamp(3.5rem, 9vh, 6.5rem)`) because it is a threshold, not a room. Museum air: rooms breathe more than ordinary sections do.

The room sequence, in order: entrance panel (wall) → painting I (wall) → vitrine (floor) → touchable exhibit (floor) → painting II (wall) → setup steps (floor) → price (floor) → collection (floor) → wish form (floor) → painting III (wall) → the way out (night). Consecutive floor rooms drop the duplicated top hairline (`.dg-room--floor + .dg-room--floor`) so the floor reads as one continuous surface rather than a stack of bands.

Internal grids are all two-column, and asymmetric wherever the meaning is asymmetric: the vitrine is 1fr / 1fr, the touchable exhibit 1fr / 0.8fr (frame, then facts), the setup band 1fr / 1fr (prose, then steps), the offer card 1.15fr / 0.85fr (the work, then the plinth). A hung work is centred in `min(1000px, 100% - 2 × gutter)`.

**Breakpoints.** At 860px every two-column grid collapses to one column, the embedded setter shortens from 30rem to 26rem, and the painting frame thins from 10px to 6px while dropping its 76vh height cap so a tall canvas can run full length on a narrow screen. At 560px collection rows stack and the lamp CTA goes full width and centres.

## Elevation & Depth

This system is flat by conviction. There are no card shadows, no glass, no backdrop blur — the navigation explicitly sets `backdrop-filter: none` when it enters this world. Depth comes from **ground changes and hairlines**: a new room announces itself by changing colour underfoot, and structure inside a room is drawn with 1px borders in that ground's own line colour. Layering on the floor is tonal, exactly one step from plaster to raised plaster.

Two shadows exist, and both are physical claims rather than decoration.

### Shadow Vocabulary
- **Hung work** (`box-shadow: 0 18px 40px -18px rgba(0, 0, 0, 0.65)`): the painting standing off the wall. Only on framed artwork.
- **Lamp glow, rest** (`box-shadow: 0 10px 22px -10px rgba(23, 19, 15, 0.5), 0 20px 44px -14px rgba(245, 215, 107, 0.55)`): a lit thing spills light — a dark drop plus a yellow bloom, on the one filled button.
- **Lamp glow, hover** (`0 14px 28px -10px rgba(23, 19, 15, 0.5), 0 30px 60px -14px rgba(245, 215, 107, 0.7)`) and **pressed** (`0 6px 14px -8px rgba(23, 19, 15, 0.5), 0 14px 30px -14px rgba(245, 215, 107, 0.45)`): the bloom grows on approach and collapses under the finger.

### Named Rules
**The Two Shadows Rule.** A shadow here is either a painting standing off a wall or a lamp spilling light. Cards, panes, chips, inputs and the offer plinth are flat; if a surface needs to separate, change its ground or draw a hairline.

**The Blur-Free-Ledge Rule.** Every shadow in this world has real blur and a negative spread. A zero-blur offset ledge belongs to a neobrutalist world and is not available here.

**One authored moment.** Exactly one thing on this page moves with the scroll: `.dg-canvas` drifts against it, the way a hung picture does when you walk along a wall. It is declared inside `@supports (animation-timeline: view())` and composes `dg-arrive` with `dg-drift` on two timelines, using `translate` rather than `transform` so the two never overwrite each other, and both are composited so neither repaints.

Nothing else animates on scroll or on entry. Labels, facts, steps, the offer card and the closing block each carried the same entrance at one point; an identical animation on every element is scattered effects wearing one name, and all of them were removed. The only other transition in the world is the lamp answering the pointer: `transform` and `box-shadow` over 160ms `cubic-bezier(0.16, 1, 0.3, 1)`, lifting 2px on hover and settling 1px down on press. A scroll-driven blur on the artworks was built and deliberately removed.

## Shapes

Radius is zero, everywhere, without exception — including on inherited app components pulled into this world: the wish form's inputs and submit button, the language switcher, and the nav's buttons all have their radius reset to 0. Corners are cut, not softened; nothing is a pill.

The recurring form is the **rectangle with a drawn edge**: a 1px hairline in the ground's line colour around panes, message blocks, chips, inputs, the setter frame and the offer card. The single heavier edge in the world is the painting frame — a flat 10px solid night border (6px below 860px), the way a modern gallery hangs a small Rousseau: a hard edge, then the wall. Canvases size by their own proportions (`width: auto; height: auto; max-width: 100%; max-height: 76vh`) so a portrait canvas stays tall instead of being letterboxed inside a wide mount.

Focus is a drawn rectangle too: a 3px oxblood-deep outline offset 3px, switching to lamp yellow anywhere the ground is dark (wall rooms, the closing room, the offer's buy panel), with radius forced to 0 so the ring matches the shape it surrounds.

## Components

### Buttons
- **Shape:** hard rectangle (radius 0); minimum height 52px for the lamp, 48px for ink buttons, 44px for chips.
- **Lamp (primary):** yellow fill with night text and a 1px lamp-deep edge, display face at 1.05rem/700, padding `0.85rem 1.6rem`, an 18px inline arrow SVG at a 0.6rem gap, and the lamp glow shadow. It is the only filled button on the page and appears three times: entrance, offer plinth, closing room.
- **Hover / Focus:** lifts 2px with a wider bloom over 160ms; press settles 1px down with the bloom collapsed. Focus-visible draws the lamp ring on dark grounds, the oxblood ring on light.
- **Outline (navigation):** transparent fill, 1px night-line edge, night ink, display face, no shadow. On hover the fill goes night-raised and both edge and text go lamp.
- **Ink (forms):** solid ink on raised plaster, display face, 48px tall, shadow explicitly cleared; hover lightens to ink-muted.
- Below 560px the lamp stretches full width and centres its contents.

### Chips
- **Style:** transparent with a 1px plaster-line edge, ink-muted text in the body face at 0.95rem, 44px minimum height, square. Used only to filter the rest of the collection, and only rendered when there are at least two categories.
- **State:** the active chip inverts to a solid ink fill with plaster text and an ink edge. There is no hover styling; selection is the only state that changes appearance.

### Cards / Containers
- **Corner Style:** square (radius 0).
- **Background:** raised plaster for panes, the offer card, the setter frame and the wish-form band; plain plaster for blocks nested inside a pane, so nesting reads as one tone *down* rather than one shadow *up*.
- **Shadow Strategy:** none. See Elevation & Depth.
- **Border:** 1px plaster-line for ordinary panes; 1px ink for the two containers that carry a commitment — the offer card and the setter frame.
- **Internal Padding:** `clamp(1.1rem, 2.5vw, 1.75rem)` for panes; `clamp(1.5rem, 3vw, 2.5rem)` for the offer card's two halves.

### Inputs / Fields
- **Style:** 1px plaster-line stroke on plaster fill, square, 48px minimum height, `0.65rem 0.9rem` padding, body face at 1rem in ink. Labels are body face in full ink, not muted.
- **Focus:** the border goes oxblood and a 3px oxblood outline sits 2px off it; the inherited colour-halo box-shadow is explicitly cleared. The world's own focus treatment, not a glow.
- **Error:** loss red at weight 600.

### Navigation
- Night ground with a night-line bottom edge and blur explicitly disabled. Logo and links in the display face at night ink; hover and active go lamp. The company line sits in night-ink-muted. The language switcher is a squared, transparent, night-line-bordered group whose active segment fills night-line. Nav actions are outlines, never filled — the page's one fill is reserved for the lamp.
- The footer is night-raised with a night-line top edge and the body face, aligned to the same 1240 column as the rooms; links sit in night-ink-muted and go lamp on hover; support links are underlined at a 0.22em offset.

### The Hung Work (signature)
A `figure` holding one framed canvas and one museum wall label. **The label order is fixed:** artist, then title (italic, body face), then metadata and public-domain rights on one muted line, then a hairline rule (`1px rgba(242, 227, 213, 0.28)`), and only after that our own interpretive sentence. The catalogue facts always precede our reading, so our line can never pose as part of the artwork's record. Labels are capped at 52ch and left-aligned under the canvas. The first work loads eagerly (it is the LCP image); the other two are lazy. All three carry intrinsic `width`/`height` attributes so the room does not shift as they arrive.

### The Vitrine (signature)
Two equal panes on the floor showing the same thread at two moments: the unread message at night, and the booked call. Times in both panes are set in the measurement style. Below the panes, the authored-demonstration disclosure sits in **primary ink** at 0.85rem with 0.04em tracking — not muted, not small-print grey.

### The Touchable Exhibit (signature)
The real production concierge, embedded same-origin in a square ink-bordered frame with an ink title bar carrying a live/off readout. Before framing it, the page probes whether the slug actually serves; if it does not, the frame renders a plain-language unavailable state (18rem minimum height, body face, ink-muted, display-face lead-in) and the room's own intro copy switches to match. A page whose argument is "it answers" never stages a conversation it cannot have.

## Do's and Don'ts

### Do:
- **Do** alternate wall and floor. A new room announces itself by changing the ground underfoot, not by growing a shadow.
- **Do** keep every neutral warm; take greys from the plaster, bone, ink or night ramps.
- **Do** give each ground exactly two inks — one primary, one muted.
- **Do** reset radius to 0 and clear the box-shadow on anything inherited from `src/index.css` that enters this world.
- **Do** put catalogue facts before interpretation in any wall label, separated by a hairline.
- **Do** set times and prices with tabular figures; clocks additionally tracked at 0.08em.
- **Do** state an unavailable state in plain words at full weight, and label authored demonstration content in primary ink.
- **Do** let a canvas size by its own proportions (`width: auto; height: auto` with both caps) so a portrait work is never letterboxed.
- **Do** cap reading columns in `ch` (18 / 50–52 / 62 / 54).
- **Do** declare this world's tokens on the shared `.dg-page, .app-nav-dg, .app-footer-dg` selector — nav and footer are DOM siblings, not children.

### Don't:
- **Don't** fill a second control with lamp yellow. One lit button per page; everything else is an outline or ink.
- **Don't** introduce a cool grey, a pure black, or a pure white anywhere in this world.
- **Don't** add a border radius, a pill, a glass surface, or a backdrop blur.
- **Don't** ship a zero-blur offset shadow; both shadows here have real blur and negative spread.
- **Don't** animate on scroll or on entry. The lamp's 160ms pointer response is the whole motion budget.
- **Don't** constrain a wall room to the shell's max-width — rooms are full-bleed; only their contents are re-columned at 1240px.
- **Don't** use an icon font or a glyph character as an icon. The two icons on the page (arrow, check) are inline SVG at 16–18px with `currentColor` and `aria-hidden`.
- **Don't** add an uppercase kicker or eyebrow above a heading; rooms open on the heading itself.
- **Don't** hardcode a status colour. Notice, error and success states must come from the token palette, not from literals dropped at the call site.
- **Don't** put a scarcity or founding-price claim on this page. €200 is the only number it shows.
