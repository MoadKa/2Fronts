# Concierge question-gate conversation flow

**Date:** 2026-07-22
**Area:** AI Booking Concierge public chat (`/c/:slug`)
**Status:** approved forks, implementing

## Goal

Reshape the public concierge conversation into a controlled flow:

1. Ask for contact (**name + email**, kept — coach's lead notification needs the name).
2. Ask **"Do you have any questions?"** with **Yes / No** buttons.
   - **No** → proceed to the bot's qualification question(s).
   - **Yes** → open a free-type Q&A loop; the AI answers each question. A single
     **"I have no more questions"** button ends the loop (no per-question re-ask).
3. Run the existing qualification quick-reply questions.
4. Before the booking link, ask **once more**: "Any questions before I send the link?"
   - **Yes** → back into the Q&A loop until they click "no more questions".
   - **No** → send the booking link directly.

## Key decisions (approved)

- **Opening step:** keep name + email (not email-only).
- **Question loop:** free-typing + a single exit button, not a Yes/No re-ask each time.

## Architecture

State lives in a new `concierge_conversations.phase` column (text, default
`'contact'`). The `concierge-chat` edge function is a deterministic state machine
over that phase. **No client changes**: the React page already renders
`quick_replies` buttons and the composer together, so gates and the exit button
are ordinary `quick_replies` prompts with reserved control criterion IDs.

### Phases

`contact` → `intro_gate` → (`answering_intro` ⇄) → `qualifying` → `final_gate` →
(`answering_final` ⇄) → `booking`

### Reserved control criterion IDs (never real criteria)

- `__intro_gate__` — Yes/No: questions before we start?
- `__final_gate__` — Yes/No: questions before the booking link?
- `__done_questions__` — single "no more questions" exit button.

Yes/No is encoded in the option's `qualifies` boolean (`true` = "Yes, I have
questions"). These IDs are intercepted before qualification logic, so they never
pollute `qualification_answers`.

### Transitions

- **Contact submit** → store name+email, greet by name, phase `intro_gate`,
  return the Yes/No intro-gate prompt.
- **intro_gate**
  - Yes → `answering_intro`, "ask away", return the exit button.
  - No → `proceedAfterIntro`.
- **answering_intro** (free text) → AI answers grounded, booking suppressed, stay,
  re-show exit button. Exit button → `proceedAfterIntro`.
- **proceedAfterIntro**: next unanswered criterion? → `qualifying`, ask it (quick
  replies). Else (no criteria) → `booking` directly.
- **qualifying** → existing quick-reply + free-text-classification loop, unchanged,
  except: booking is suppressed while a criterion is still unanswered, and when the
  **last** criterion is answered → `final_gate` (instead of booking).
- **final_gate**
  - Yes → `answering_final`, "ask away", exit button.
  - No → `booking`.
- **answering_final** (free text) → AI answers grounded, booking suppressed, stay,
  re-show exit button. Exit button → `booking`.
- **booking** → booking invite + link (`show_booking: true`, outcome
  `booking_shown`). Later free text still answered; booking may resurface.

Phase `contact` free text keeps the legacy grounded path (covers pre-contact edge
cases and all existing tests, which operate at phase `contact`).

### Booking suppression rule

`show_booking: true` is only ever returned from: final_gate "No",
answering_final exit, and booking-phase model replies. Everywhere earlier it is
forced false, so the calendar link only appears at the very end.

## New copy (DE/EN, in the edge function, native German, no em dashes)

- Intro gate: `Danke, {name}! Bevor wir starten: Hast du noch Fragen an mich?`
- Gate options: `Ja, ich habe Fragen` (qualifies) / `Nein, lass uns loslegen`.
- Ask away: `Klar, frag einfach. Ich beantworte dir, was ich kann.`
- Exit button: `Ich habe keine Fragen mehr`.
- Final gate: `Alles klar. Bevor ich dir den Termin schicke: Hast du vorher noch Fragen?`
- Booking invite: existing `bookingInvite`.

## Testing

Extend `concierge-chat/index.test.ts`: intro gate after contact, Yes→answering→
exit→qualifying, No→qualifying/booking, qualification-complete→final_gate,
final_gate No→booking, final_gate Yes→answering_final→exit→booking, booking
suppression, free-text-during-gate → answering. Update the two contact tests and
the two qualification-complete tests to the new phase behavior. Mock harness gains
`phase` on the conversation row + a captured `phaseUpdate`.
