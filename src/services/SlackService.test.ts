import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getProvisionConnectorType,
  listSlackChannels,
  confirmSlackChannel,
} from './SlackService'

let selectResult: { data: unknown; error: unknown } = { data: null, error: null }
let invokeResult: { data: unknown; error: unknown } = { data: null, error: null }
let capturedInvoke: { name: string; body: unknown } | null = null
let capturedSelect: { table: string; col: string; val: unknown } | null = null

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: (col: string, val: unknown) => {
          capturedSelect = { table, col, val }
          return { single: () => Promise.resolve(selectResult) }
        },
      }),
    }),
    functions: {
      invoke: (name: string, opts: { body: unknown }) => {
        capturedInvoke = { name, body: opts.body }
        return Promise.resolve(invokeResult)
      },
    },
  },
}))

describe('SlackService', () => {
  beforeEach(() => {
    selectResult = { data: null, error: null }
    invokeResult = { data: null, error: null }
    capturedInvoke = null
    capturedSelect = null
  })

  it('getProvisionConnectorType reads connector_type for the provision', async () => {
    selectResult = { data: { connector_type: 'slack_notifications' }, error: null }
    const type = await getProvisionConnectorType('prov-1')
    expect(type).toBe('slack_notifications')
    expect(capturedSelect).toEqual({ table: 'automation_provisions', col: 'id', val: 'prov-1' })
  })

  it('getProvisionConnectorType returns null on error', async () => {
    selectResult = { data: null, error: { message: 'nope' } }
    expect(await getProvisionConnectorType('prov-1')).toBeNull()
  })

  it('listSlackChannels invokes slack-configure action list and returns channels', async () => {
    const list = [{ id: 'C1', name: 'leads' }]
    invokeResult = { data: { channels: list }, error: null }

    const result = await listSlackChannels('prov-1')

    expect(capturedInvoke?.name).toBe('slack-configure')
    expect(capturedInvoke?.body).toEqual({ provisionId: 'prov-1', action: 'list' })
    expect(result).toEqual(list)
  })

  it('listSlackChannels returns an empty array when none are present', async () => {
    invokeResult = { data: {}, error: null }
    expect(await listSlackChannels('prov-1')).toEqual([])
  })

  it('listSlackChannels maps a function error to an i18n key', async () => {
    invokeResult = {
      data: null,
      error: { context: { json: () => Promise.resolve({ error: 'no_connection' }) } },
    }
    await expect(listSlackChannels('prov-1')).rejects.toThrow('slackConnect.errors.connection')
  })

  it('confirmSlackChannel invokes slack-configure action confirm with the channel', async () => {
    invokeResult = { data: { ok: true }, error: null }
    await confirmSlackChannel('prov-1', 'C1', 'leads')
    expect(capturedInvoke?.name).toBe('slack-configure')
    expect(capturedInvoke?.body).toEqual({
      provisionId: 'prov-1',
      action: 'confirm',
      channelId: 'C1',
      channelName: 'leads',
    })
  })

  it('confirmSlackChannel throws a generic i18n key on an unrecognised error', async () => {
    invokeResult = { data: null, error: { message: 'persist_failed' } }
    await expect(confirmSlackChannel('prov-1', 'C1', 'leads')).rejects.toThrow(
      'slackConnect.errors.generic',
    )
  })
})
