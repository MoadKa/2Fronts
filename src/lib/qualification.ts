// Shared lead-qualification contract (frontend copy). The concierge setup wizard
// writes QualCriterion[] onto the concierge; the public chat presents each
// criterion's options as quick-reply buttons and records the visitor's choice as
// a QualAnswer. A Deno copy lives at supabase/functions/_shared/qualification.ts
// (frontend and edge functions can't share a module) — keep the two in sync.

export interface QualOption {
  label: string
  // Whether choosing this option counts toward "qualified". The coach sets this
  // per option in the wizard (e.g. budget "5k+" qualifies, "<1k" does not).
  qualifies: boolean
}

export interface QualCriterion {
  // 'budget' | 'industry' | 'age' | 'timeline_role' for built-ins, or 'custom_<n>'
  // for coach-authored criteria. Stable so answers map back to their criterion.
  id: string
  // The question the concierge asks in chat (coach-authored content, not an i18n
  // key — the AI speaks it verbatim).
  question: string
  // The quick-reply buttons. Coach-authored labels.
  options: QualOption[]
}

// One recorded answer in a conversation (concierge_conversations.qualification_answers).
export interface QualAnswer {
  criterion_id: string
  label: string
  qualifies: boolean
}

// What the chat returns when it wants the visitor to answer the next criterion:
// a question + its options rendered as quick-reply buttons. Clicking a button
// sends back the matching QualAnswer.
export interface QualPrompt {
  criterion_id: string
  question: string
  options: QualOption[]
}

// The built-in criteria the wizard offers as starting points (the coach toggles
// them on, edits labels, and marks which options qualify). Default option labels
// live in i18n (conciergeOnboarding.qualify.presets.*); these ids are the stable
// contract shared with the chat runtime.
export const BUILTIN_CRITERION_IDS = ['budget', 'industry', 'age', 'timeline_role'] as const
export type BuiltinCriterionId = (typeof BUILTIN_CRITERION_IDS)[number]

// A visitor is qualified when every ANSWERED criterion's chosen option qualifies.
// Returns null while nothing has been answered yet (so the UI/coach can tell
// "not evaluated" apart from "evaluated, not qualified"). Simple AND rule for v1.
export function evaluateQualified(answers: QualAnswer[]): boolean | null {
  if (answers.length === 0) return null
  return answers.every((a) => a.qualifies)
}

// The next criterion to ask: the first one with no recorded answer yet. Returns
// null when every criterion has been answered (qualification complete).
export function nextUnansweredCriterion(
  criteria: QualCriterion[],
  answers: QualAnswer[],
): QualCriterion | null {
  const answered = new Set(answers.map((a) => a.criterion_id))
  return criteria.find((c) => !answered.has(c.id)) ?? null
}
