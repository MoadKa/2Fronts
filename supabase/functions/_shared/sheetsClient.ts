// A thin Google Sheets v4 REST client. Two operations only:
//   readHeaderRow -- read the first row (+ a sample row) so the AI mapper can
//                    see the customer's column layout at first-connect time.
//   appendRow     -- file one lead as a NEW row, append-only.
//
// APPEND-ONLY IS A HARD INVARIANT (product req F3): a confidently wrong write
// into a customer's sheet is silent and trust-destroying. We use
// values.append with insertDataOption=INSERT_ROWS, which the Sheets API
// guarantees inserts brand-new rows -- it never overwrites or updates existing
// cells. We never call values.update / batchUpdate from here.
//
// OAuth is out of scope here (another lane stores + refreshes tokens). The
// caller passes a ready access token. fetch is injectable (mirrors the
// TwilioFetcher pattern in twilioProvision.ts) so tests run with no network.

export type SheetsFetcher = (url: string, init?: RequestInit) => Promise<Response>

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` }
}

// Reads the header row (row 1) and the first sample data row (row 2) of the
// first sheet. We grab A1:Z2 -- wide enough for any realistic lead sheet,
// cheap enough to never paginate. Returns the header cells and, if present,
// the first data row, for the AI column mapper to reason over.
export async function readHeaderRow(
  spreadsheetId: string,
  accessToken: string,
  fetcher: SheetsFetcher = fetch,
): Promise<{ headers: string[]; sampleRow: string[] }> {
  const range = 'A1:Z2'
  const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`

  const res = await fetcher(url, { headers: authHeaders(accessToken) })
  const data = (await res.json()) as { values?: string[][]; error?: { message?: string } }
  if (!res.ok) {
    throw new Error(data.error?.message ?? `Failed to read header row (status ${res.status})`)
  }

  const values = data.values ?? []
  return {
    headers: values[0] ?? [],
    sampleRow: values[1] ?? [],
  }
}

// Appends a single new row. insertDataOption=INSERT_ROWS forces the API to
// push a fresh row in rather than overwriting whatever currently follows the
// table -- this is the append-only guarantee. valueInputOption=RAW writes the
// values verbatim (no formula/locale interpretation of lead data).
export async function appendRow(
  spreadsheetId: string,
  values: string[],
  accessToken: string,
  fetcher: SheetsFetcher = fetch,
): Promise<void> {
  const range = 'A1'
  const url =
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append` +
    `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`

  const res = await fetcher(url, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [values] }),
  })

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(data.error?.message ?? `Failed to append row (status ${res.status})`)
  }
}
