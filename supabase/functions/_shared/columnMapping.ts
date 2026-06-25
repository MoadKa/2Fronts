// The AI column mapper -- the heart of the lead-filing engine.
//
// At first-connect we read the customer's sheet header row (+ a sample lead).
// We can't assume the columns are named, ordered, or even in the language we
// expect: one customer's sheet has "Name | Telefon | E-Mail", another has
// "Voornaam | GSM | Mail | Bron". proposeColumnMapping asks an LLM to line up
// each of OUR canonical fields with one of THEIR columns.
//
// CRITICAL PRODUCT REQUIREMENT (F3): a confidently WRONG write into a
// customer's spreadsheet is silent and trust-destroying. So this mapper is
// honest about doubt:
//   - every field carries a confidence: 'high' | 'low'
//   - when the model is unsure which column a field maps to, it returns
//     column=null + confidence='low' -- it must NEVER invent or guess a column.
// A null/low field is surfaced to a human for confirmation downstream; it is
// never auto-filled. Better an unmapped field than a wrong one.
//
// The LLM call is an injectable dep (`complete`) so tests pin it down with
// canned JSON and run with no network. A real default impl calling the
// Google Gemini API is provided at the bottom.

import { geminiFetchWithRetry } from './geminiRetry.ts'

export type Confidence = 'high' | 'low'

// Our canonical lead fields. Stable identifiers the rest of the pipeline keys
// off; the human-readable label/hint is what the LLM reasons over.
export interface CanonicalField {
  field: string
  // A short description so the model can match across languages/synonyms
  // (e.g. Telefon <- "GSM", "Mobiel", "Phone", "Tel").
  description: string
}

export interface ColumnMappingEntry {
  field: string
  // The customer's column header this field maps to, or null when unsure.
  column: string | null
  confidence: Confidence
}

export interface ProposeColumnMappingInput {
  headers: string[]
  sampleLead?: Record<string, string>
  fields: CanonicalField[]
}

// The one external effect: turn a prompt into a completion string. Injectable
// so tests are deterministic and offline.
export type CompleteFn = (prompt: string) => Promise<string>

export interface ColumnMappingDeps {
  complete: CompleteFn
}

// The default canonical lead fields for the missed-call / intake automations.
export const DEFAULT_LEAD_FIELDS: CanonicalField[] = [
  { field: 'Name', description: "The lead's full name (e.g. Voornaam, Naam, Klant, Contact)." },
  { field: 'Telefon', description: "The lead's phone number (e.g. Telefoon, GSM, Mobiel, Tel, Phone)." },
  { field: 'E-Mail', description: "The lead's email address (e.g. Email, Mail, E-mailadres)." },
  { field: 'Quelle', description: 'Where the lead came from (e.g. Bron, Source, Kanaal, Channel).' },
  { field: 'Datum', description: 'The date/time the lead arrived (e.g. Datum, Date, Tijd, Timestamp).' },
]

function buildPrompt(input: ProposeColumnMappingInput): string {
  const sampleLine = input.sampleLead && Object.keys(input.sampleLead).length > 0
    ? `\nA sample row from the sheet (header -> value): ${JSON.stringify(input.sampleLead)}`
    : '\n(No sample data rows in the sheet yet.)'

  const fieldList = input.fields
    .map((f) => `- "${f.field}": ${f.description}`)
    .join('\n')

  // We instruct the model to be conservative: null + low when unsure, never a
  // guess. The output contract is strict JSON we can parse without prose.
  return [
    'You are mapping a CRM\'s canonical lead fields onto the columns of a',
    "customer's Google Sheet, so incoming leads can be filed in the right",
    'columns. The sheet may be in any language.',
    '',
    `The sheet's column headers are: ${JSON.stringify(input.headers)}`,
    sampleLine,
    '',
    'Map each of these canonical fields to exactly one column header, or to',
    'null if no column clearly matches:',
    fieldList,
    '',
    'Rules:',
    '- Use ONLY a header from the list above as a "column" value, copied verbatim.',
    '- If you are not confident a header matches the field, set "column" to null.',
    '- "confidence" is "high" only when the match is unambiguous; otherwise "low".',
    '- A field whose column is null MUST have confidence "low".',
    '- Never guess. An unmapped field is better than a wrong one.',
    '',
    'Respond with ONLY a JSON array, no prose, of the form:',
    '[{"field": "...", "column": "..." | null, "confidence": "high" | "low"}]',
  ].join('\n')
}

// Pull the JSON array out of a model response that may be wrapped in prose or a
// ```json fence, and parse it. Returns [] if nothing parseable is found.
function parseMappingResponse(raw: string): unknown[] {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Column mapping response did not contain a JSON array')
  }
  const slice = raw.slice(start, end + 1)
  const parsed = JSON.parse(slice)
  if (!Array.isArray(parsed)) {
    throw new Error('Column mapping response was not a JSON array')
  }
  return parsed
}

// Asks the LLM to map every canonical field to a column. The result is
// NORMALIZED defensively against the F3 invariant, so a sloppy or adversarial
// model response can never produce a confident wrong mapping:
//   - every requested field appears exactly once, in the requested order
//   - a column the model returned that isn't a real header is dropped to null
//   - column=null always forces confidence='low'
//   - anything not explicitly 'high' is treated as 'low'
export async function proposeColumnMapping(
  input: ProposeColumnMappingInput,
  deps: ColumnMappingDeps,
): Promise<ColumnMappingEntry[]> {
  const raw = await deps.complete(buildPrompt(input))
  const parsed = parseMappingResponse(raw)

  // Index the model's answers by field for lookup; ignore unknown extras.
  const byField = new Map<string, { column: unknown; confidence: unknown }>()
  for (const item of parsed) {
    if (item && typeof item === 'object' && 'field' in item) {
      const f = (item as { field: unknown }).field
      if (typeof f === 'string') {
        byField.set(f, item as unknown as { column: unknown; confidence: unknown })
      }
    }
  }

  const headerSet = new Set(input.headers)

  return input.fields.map((canonical): ColumnMappingEntry => {
    const answer = byField.get(canonical.field)

    // A column counts only if it's a verbatim, real header. Anything else --
    // missing, null, a hallucinated header -- collapses to an unmapped field.
    let column: string | null = null
    if (answer && typeof answer.column === 'string' && headerSet.has(answer.column)) {
      column = answer.column
    }

    // Confidence is 'high' ONLY for a real mapped column the model called high.
    // Unmapped -> always 'low'. Unknown/garbage confidence -> 'low'.
    const confidence: Confidence = column !== null && answer?.confidence === 'high' ? 'high' : 'low'

    return { field: canonical.field, column, confidence }
  })
}

// ---------------------------------------------------------------------------
// Default real implementation of `complete`, calling the Google Gemini API via
// fetch. Flash is plenty for column matching and keeps cost/latency low (and
// it's the same Google project as the Sheets OAuth integration). temperature 0
// keeps the mapping deterministic. The API key comes from the environment and
// is sent only in the x-goog-api-key header -- NEVER in the URL, a log line, an
// error message, or the returned text.

const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

export type GeminiFetcher = (url: string, init?: RequestInit) => Promise<Response>

// Builds the default `complete` using the Gemini API. The key is read once,
// here, and only ever placed in the request header -- never in the URL (which
// can be logged), an error message, or the returned text.
export function createGeminiComplete(
  apiKey: string | undefined = Deno.env.get('GEMINI_API_KEY'),
  fetcher: GeminiFetcher = fetch,
): CompleteFn {
  if (!apiKey) {
    // Fail clearly and early -- but say nothing about the key's value.
    throw new Error(
      'GEMINI_API_KEY is not set; cannot build the column-mapping LLM client',
    )
  }

  return async (prompt: string): Promise<string> => {
    const init: RequestInit = {
      method: 'POST',
      headers: {
        // Header auth keeps the key out of the URL (URLs get logged; headers don't).
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 1024 },
      }),
    }
    // Retry transient Gemini failures (rate-limit / overload / network blip).
    const res = await geminiFetchWithRetry(fetcher, GEMINI_API_URL, init)

    if (!res.ok) {
      // Surface the API's error message, but never the request we sent (which
      // carries the key in its headers).
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      throw new Error(data.error?.message ?? `Gemini API request failed (status ${res.status})`)
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => typeof p.text === 'string')
      .map((p) => p.text)
      .join('')
    return text
  }
}
