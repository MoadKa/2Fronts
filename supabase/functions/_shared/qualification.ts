// Shared lead-qualification contract (Deno/edge copy). Mirror of
// src/lib/qualification.ts — frontend and edge functions can't share a module,
// so keep the two in sync. The concierge-chat runtime imports this to pick the
// next quick-reply question and evaluate whether a conversation is qualified.

export interface QualOption {
  label: string
  qualifies: boolean
}

export interface QualCriterion {
  id: string
  question: string
  options: QualOption[]
}

export interface QualAnswer {
  criterion_id: string
  label: string
  qualifies: boolean
}

// What the chat returns when it wants the visitor to answer the next criterion:
// a question + options rendered as quick-reply buttons.
export interface QualPrompt {
  criterion_id: string
  question: string
  options: QualOption[]
}

// A visitor is qualified when every ANSWERED criterion's chosen option qualifies.
// Null until at least one answer exists. Simple AND rule for v1.
export function evaluateQualified(answers: QualAnswer[]): boolean | null {
  if (answers.length === 0) return null
  return answers.every((a) => a.qualifies)
}

// The next criterion to ask: the first with no recorded answer. Null when done.
export function nextUnansweredCriterion(
  criteria: QualCriterion[],
  answers: QualAnswer[],
): QualCriterion | null {
  const answered = new Set(answers.map((a) => a.criterion_id))
  return criteria.find((c) => !answered.has(c.id)) ?? null
}
