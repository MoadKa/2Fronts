// Shared transient-retry wrapper for the Gemini fetch clients (conciergeChat,
// conciergeDraft, columnMapping). Gemini occasionally returns a 429 (rate limit)
// or a 5xx (overload), or the request dies at the network layer. A single such
// blip would otherwise surface to the user mid-flow as a hard error (e.g. the
// concierge telling a visitor "something went wrong" and losing the booking).
// We retry those a few times with a short escalating backoff. We do NOT retry a
// 4xx (bad key / bad request) — it won't recover and retrying just delays the
// real error. The caller keeps its own !res.ok handling and response parsing;
// this only governs WHEN to give up.

export type GeminiFetcher = (url: string, init?: RequestInit) => Promise<Response>

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Send the request, retrying transient failures (network error or a retryable
// status) up to `maxAttempts` with a 250ms * attempt backoff. Returns the final
// Response (which may still be a non-ok the caller must handle); re-throws the
// network error only if every attempt failed at the network layer. The request
// body lives in `init` (key only in headers), so re-sending it is safe.
export async function geminiFetchWithRetry(
  fetcher: GeminiFetcher,
  url: string,
  init: RequestInit,
  maxAttempts = 3,
): Promise<Response> {
  let res: Response | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      res = await fetcher(url, init)
    } catch (e) {
      if (attempt === maxAttempts) throw e
      await sleep(250 * attempt)
      continue
    }
    if (res.ok || !RETRYABLE_STATUS.has(res.status) || attempt === maxAttempts) break
    await sleep(250 * attempt)
  }
  return res!
}
