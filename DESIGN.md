# Design System — 2Fronts „Der Nachttisch"

Verbindliche Quelle für jede visuelle Entscheidung. Ersetzt `design-system/MASTER.md`
(„Apple in Orange") als Richtung; Tokens dort werden beim Umbau migriert.
Freigegeben vom Founder am 2026-07-04 nach Live-Preview
(`~/.gstack/projects/MoadKa-2Fronts/designs/design-system-20260704/nachttisch-v3.html`).

## Produkt-Kontext
- **Was:** AI Appointment Setter für Coaches (199 €/Monat, Abo). Chattet mit
  Interessenten auf der Seite des Coaches, antwortet nur aus dessen Inhalten,
  qualifiziert, bucht Erstgespräche.
- **Für wen:** deutsch- und englischsprachige Coaches/Berater, die über
  Erstgespräche verkaufen. Skeptisch, sehen täglich SaaS-Seiten, allergisch
  gegen KI-Einheitslook.
- **Projekt-Typ:** Marketing-Site (React SPA + statische SEO-Seiten) + Kunden-App.

## Der Merksatz (Nordstern)
**„Antwortet um 23 Uhr."** Jede Design-Entscheidung dient diesem einen Eindruck.
Was ihn nicht stützt, fliegt raus.

## Ästhetik
- **Richtung:** Cinematic Still-Life. Die Marketing-Seite erzählt eine Nacht:
  Akt 1 ist Nacht (der Schmerz), die Seite wacht beim Scrollen auf (Morgen).
- **Dekoration:** intentional. Licht (Lampen-Spill) und echte Artefakte
  (Chat, Kalender) statt Illustrationen. Keine Deko um der Deko willen.
- **Die zwei Schmerzen als Seitenstruktur (freigegeben):**
  1. **Hero (Nacht):** die verlorene Anfrage. Messenger-Chat auf einem Handy:
     Kundin schreibt 23:12, Coach antwortet 08:34, Follow-up, „habe woanders
     gebucht", rote Karte „Anfrage verloren · von der Konkurrenz gestohlen".
     Zweisprachig (DE/EN), Chat scrollt automatisch, Tipp-Indikator, Haken.
  2. **Sektion 2 (Morgen):** der falsche volle Kalender. Kalender-Karte mit
     durchgestrichenen Terminen (kostenlose Tipps / No-Show / kein Budget),
     Bilanz „4,5 Std geblockt · 0 Kunden". Für Calendly-in-der-Bio-Coaches.
  3. Danach Auflösung/Beweis (Demo-Video, Funktionsweise), ehrlicher Preis, CTA.

## Typografie
- **Display/Hero:** **Fraunces** (Google Fonts), weight ~640, opsz hoch,
  letter-spacing −0.005em, line-height ~1.05. Rolle: „vertrauter Berater",
  Anti-KI-Signal. Auch für Sektions-Headlines (h2) auf hell.
- **Body/UI:** **Schibsted Grotesk** 400/500/700. 16–17px, line-height 1.6–1.65.
- **Zeiten/Daten/Labels:** **Fragment Mono**, `font-variant-numeric: tabular-nums`.
  Timestamps sind Markenzeichen: immer echte Uhrzeiten (23:12), nie „spätabends".
- **Verboten:** Space Grotesk (KI-Konvergenz-Font, war Alt-System), Inter,
  Roboto, Poppins, Montserrat, system-ui als Display.
- **Laden:** Google Fonts via `<link>` (kein @import). Fraunces + Schibsted +
  Fragment Mono; DM Sans bleibt nur, bis Bestandsseiten migriert sind.

## Farbe
- **Ansatz:** restrained. Zwei Bühnen (Nacht/Morgen), ein Akzent, ein Alarmrot.

| Rolle | Hex | Regel |
|---|---|---|
| Nacht-Ambiente | `#1C0907` | Sonnenfinsternis-Rot (Founder-Wahl 2026-07-04). NIE reines Schwarz, nie Blau-Schwarz, nie Neon. Marketing-Nachtflächen (Hero + Finale + Nacht-Nav rgba(28,9,7,.74)). |
| Text auf Nacht | `#E7E1D6` | Mondlicht-Beige, nie reines Weiß. Sekundär: rgba(231,225,214,.75). |
| Lampen-Amber | `#FFB35C` | Kicker/Links auf dunkel. Glows nutzen Ember `rgba(255,107,44,.13-.16)` (Eklipse-Korona). Nie Fläche, nie Button. |
| Morgen-Fläche | `#F8F4EC` | Seiten ab Sektion 2, Cards `#FFFDF7`, Kante `#E3DBC9`. |
| Tinte | `#1B1712` | Headings/Text auf hell. Body-Sekundär `#4B453B`, muted `#6B655B`. |
| CTA/Brand | `#EA580C` | Buttons, Links (hover `#C2410C`). Kontinuität zu Stripe/Bestand. |
| Verlust/Fehler | `#C2402A` | Verlust-Karte, durchgestrichene Termine, Fehler. |
| Erfolg | `#2E7D46` | Buchungs-Bestätigung, Erfolgs-Status. |
| Warnung | `#B45309` | Kicker auf hell, Warnhinweise. |
| Chat-Bubbles | in `#1F2529` / out `#3E2A12` | Messenger-Look: in links, out rechts, Meta-Zeile mit Zeit + ✓✓. |

- **Orange-Budget bleibt:** pro Screen 1 CTA + Links + max. 1 Highlight.
- **Dark Mode:** Die App (Dashboard/Kunde/Admin) bleibt hell & rasterdiszipliniert.
  Nacht-Treatment ist der Marketing-Bühne vorbehalten.

## Spacing & Layout
- **Basis:** 8px. Marketing großzügig (Sektions-Padding 8–10vh), App komfortabel.
- **Max-Breite:** 1240px Marketing, 720px Textseiten.
- **Hero-Grid:** ~1.05fr Copy / 0.95fr Szene, ab 900px einspaltig (Szene zuerst).
- **Radii:** Cards 16px, Phone 44px, Bubbles 14px (Ecke zur Sprecherseite 5px),
  Chips/Pills 999px.
- **Nichts zentrieren** außer bewussten Einzel-Elementen (Verlust-Karte im Chat).

## Motion
- **Signatur:** Der Hero-Chat spielt sich in echtem Messenger-Tempo ab
  (Tipp-Punkte 0,9–1,7s, Nachrichten-Abstand 0,8–1,5s, Auto-Scroll), Replay-Chip
  („23:12 · noch mal abspielen"). Verlust-/Buchungs-Karte mit pop-Overshoot.
- **Sonst:** intentional. Entrance ≤ 400ms ease-out, Hover-Lift ≤ 3px.
- **Pflicht-Fallbacks:** `prefers-reduced-motion` = fertige Szene sofort.
  Headline ist ab Load im DOM (SEO/Skimmer). Kein Inhalt existiert NUR animiert.
- **Performance-Budget:** Hero ohne Foto/3D-Assets (CSS/SVG-Phone), LCP < 2,5s
  auf Mittelklasse-Android.

## Harte Verbote (Anti-KI-Slop, deckungsgleich mit VOICE-GUARDRAIL)
Lila/Blau-Gradients · Glow-Orbs · Glassmorphism-Deko · 3-Spalten-Icon-Grids ·
zentrierte Einheits-Heros · Sparkle/AI-Ikonografie · Stock-3D-Renders ·
Gradient-Buttons · gleichförmige Bubble-Radii überall · „Built for X"-Floskeln.

## Zweisprachigkeit
Marketing-Erzählung (Hero-Chat, Kalender-Sektion) existiert vollständig in DE
und EN (i18n), inkl. Zeitformat (23:12 ↔ 11:12 PM).

## Entscheidungs-Log
| Datum | Entscheidung | Begründung |
|---|---|---|
| 2026-07-04 | System „Der Nachttisch" ersetzt „Apple in Orange" | Founder-Wahl (D2 komplett neu, D6/D7 Richtung C) nach 3 Live-Previews; Merksatz „Antwortet um 23 Uhr" |
| 2026-07-04 | Hero erzählt den VERLUST (nicht den Happy Path) | Founder-Briefing: Kunde schreibt nachts, Coach zu spät, „von der Konkurrenz gestohlen". Verlustaversion > Gewinnversprechen |
| 2026-07-04 | Fraunces als Display | Founder-Wahl aus 4 Live-Kandidaten; Anti-Konvergenz (Space Grotesk raus) |
| 2026-07-04 | Sektion 2 = falscher voller Kalender | Founder-Einwand: Calendly-in-Bio-Coaches kennen den Nacht-Schmerz nicht; ihr Schmerz ist Qualifizierung |
| 2026-07-04 | App-Flächen bleiben hell/diszipliniert | Nacht ist Marketing-Dramaturgie, kein UI-Theme |
| 2026-07-04 | Nacht-Finale als Buchstütze | Seite endet wieder um 23:12, diesmal grüne Buchungs-Karte (Spiegel der Verlust-Karte) |
| 2026-07-04 | Angebot als Stellenanzeige | Zielgruppe denkt in „Setter einstellen"; Gehaltszeile macht den Preisvergleich implizit |
| 2026-07-04 | Nacht = Sonnenfinsternis-Rot `#1C0907` | Founder: „dunkel dunkel rot wie Sonnenfinsternis", nicht Schwarz; Ember-Korona-Glows |
