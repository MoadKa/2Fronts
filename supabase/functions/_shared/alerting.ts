// Operational alerting for trust-critical lead states.
//
// When a lead lands in a state a human must look at -- it was flagged for
// manual review, or automated provisioning failed -- we POST a short message
// to an ops webhook (ALERT_WEBHOOK_URL) so the operator finds out in seconds
// instead of discovering it days later in a dashboard.
//
// Design rules this module guarantees:
//   - It NEVER throws. alert() is meant to be called from inside other
//     functions' catch blocks; an alerting failure (network error, missing
//     config) must never propagate and break lead processing. Failures are
//     swallowed and reported as `false`.
//   - If ALERT_WEBHOOK_URL is unset it is a silent no-op (returns false). A
//     deployment without alerting configured still processes leads correctly.
//   - The webhook URL is read from Deno.env at call time only. It is never
//     logged, echoed, or embedded in the message body.

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

export interface AlertEvent {
  // Short machine-ish tag for the kind of event, e.g. 'needs_review'.
  type: string
  // Human-readable one-liner the operator reads first.
  message: string
  // Optional structured context (ids, reasons) included in the payload.
  fields?: Record<string, unknown>
}

export interface AlertDeps {
  fetcher?: Fetcher
  // The webhook URL. Defaults to reading ALERT_WEBHOOK_URL from the env.
  webhookUrl?: string
}

function resolveWebhookUrl(deps?: AlertDeps): string | undefined {
  if (deps && deps.webhookUrl !== undefined) {
    return deps.webhookUrl
  }
  return Deno.env.get('ALERT_WEBHOOK_URL') ?? undefined
}

/**
 * POST an alert event to the ops webhook.
 *
 * Returns true only when the webhook is configured AND responds 2xx.
 * Returns false when the webhook is unconfigured (no-op, fetcher not called)
 * or when the request fails for any reason (non-2xx, thrown network error).
 * Never throws.
 */
export async function alert(event: AlertEvent, deps?: AlertDeps): Promise<boolean> {
  const webhookUrl = resolveWebhookUrl(deps)
  if (!webhookUrl || webhookUrl.trim() === '') {
    // Alerting not configured: no-op, do not call fetch, do not throw.
    return false
  }

  const fetcher: Fetcher = deps?.fetcher ?? fetch
  const payload = {
    type: event.type,
    text: event.message,
    fields: event.fields ?? {},
    timestamp: new Date().toISOString(),
  }

  try {
    const res = await fetcher(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return res.ok
  } catch {
    // Swallow network errors -- alerting must never break the caller.
    return false
  }
}

/**
 * A lead was flagged for manual review (a trust-critical state). Build a clear
 * operator message and dispatch it.
 */
export function alertNeedsReview(
  args: { leadId: string; customerId: string; reason: string },
  deps?: AlertDeps,
): Promise<boolean> {
  return alert(
    {
      type: 'needs_review',
      message: `Lead ${args.leadId} needs manual review: ${args.reason}`,
      fields: {
        leadId: args.leadId,
        customerId: args.customerId,
        reason: args.reason,
      },
    },
    deps,
  )
}

/**
 * Automated provisioning for a connector failed. Build a clear operator
 * message and dispatch it.
 */
export function alertProvisionFailed(
  args: { provisionId: string; connectorType: string; error: string },
  deps?: AlertDeps,
): Promise<boolean> {
  return alert(
    {
      type: 'provision_failed',
      message: `Provisioning ${args.provisionId} failed for connector ${args.connectorType}: ${args.error}`,
      fields: {
        provisionId: args.provisionId,
        connectorType: args.connectorType,
        error: args.error,
      },
    },
    deps,
  )
}
