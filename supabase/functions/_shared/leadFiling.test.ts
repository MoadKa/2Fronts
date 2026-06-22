import { assertEquals } from 'jsr:@std/assert@1'
import { fileLead, type LeadFilingDeps, type LeadRow } from './leadFiling.ts'
import type { ProvisionRow, RunResult } from './connectors.ts'

const admin = {} as never // unused: resolveProvision is injected in these tests

const lead: LeadRow = {
  id: 'lead-1',
  customer_id: 'cust-1',
  automation_id: 'auto-1',
  payload: { Name: 'Anna', Telefon: '0176' },
  source: 'api',
}

const provisionWithMapping: ProvisionRow = {
  id: 'prov-1',
  connector_type: 'google_sheets',
  config: { spreadsheetId: 'sheet-1', columnMapping: [{ field: 'Name', column: 'Name' }] },
}

function deps(overrides: Partial<LeadFilingDeps>): LeadFilingDeps {
  return {
    getAccessToken: () => Promise.resolve('access-token'),
    ...overrides,
  }
}

Deno.test('skips when the customer has no confirmed mapping yet', async () => {
  const result = await fileLead(
    admin,
    lead,
    deps({ resolveProvision: () => Promise.resolve(null) }),
  )
  assertEquals(result.outcome, 'skipped')
})

Deno.test('files the lead and forwards a working access token to the connector', async () => {
  let seenLeadId = ''
  let resolvedToken = ''
  const runConnector = async (ctx: { lead: { id: string }; deps: { getAccessToken: () => Promise<string> } }): Promise<RunResult> => {
    seenLeadId = ctx.lead.id
    resolvedToken = await ctx.deps.getAccessToken()
    return { outcome: 'filed' }
  }

  const result = await fileLead(
    admin,
    lead,
    deps({ resolveProvision: () => Promise.resolve(provisionWithMapping), runConnector: runConnector as never }),
  )

  assertEquals(result.outcome, 'filed')
  assertEquals(seenLeadId, 'lead-1')
  assertEquals(resolvedToken, 'access-token')
})

Deno.test('passes a needs_review outcome (and its reason) straight through', async () => {
  const result = await fileLead(
    admin,
    lead,
    deps({
      resolveProvision: () => Promise.resolve(provisionWithMapping),
      runConnector: (() => Promise.resolve({ outcome: 'needs_review', reason: 'missing Telefon' })) as never,
    }),
  )
  assertEquals(result.outcome, 'needs_review')
  assertEquals(result.reason, 'missing Telefon')
})
