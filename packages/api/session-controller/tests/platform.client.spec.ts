/** Session state uses host-owned platform inputs without browser persistence or identity. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Session } from '../src/client/sessions/session.ts'
import { ClientSessions } from '../src/client/sessions/service.ts'
import type { SessionPlatform, SessionSelection, SessionSelectionStore } from '../src/client/platform.ts'
import type { SessionRequestId } from '../src/types.ts'
import { FakeApiClient, fakeRemote, ok } from './fake-api.client.ts'

const SID = 'native-session' as SessionId
const PARENT = 'native-parent' as SessionId

afterEach(() => { vi.unstubAllGlobals() })

function withoutBrowserInputs(): void {
  vi.stubGlobal('crypto', undefined)
  vi.stubGlobal('Intl', undefined)
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('browser storage read') } })
}

function inputs(prefix: string): SessionPlatform {
  let request = 0
  return { createRequestId: () => `${prefix}-${++request}` as SessionRequestId, timeZone: () => 'Europe/Rome' }
}

function selection(initial: SessionSelection): SessionSelectionStore {
  let value = initial
  return { getSnapshot: () => value, set: (next) => { value = next } }
}

it('preserves the supplied submission identity and samples the current device time zone per prompt', async () => {
  withoutBrowserInputs()
  const api = new FakeApiClient()
  let zone = 'Europe/Rome'
  const session = new Session(SID, fakeRemote(api), { ...inputs('phone'), timeZone: () => zone })
  try {
    const pending = session.beginSubmission({ mode: 'queue', text: 'First', attachments: [] })
    expect(pending.requestId).toBe('phone-1')
    await session.prompt([{ type: 'text', text: 'First' }], 'queue', undefined, pending.requestId)
    zone = 'Asia/Tokyo'
    await session.prompt([{ type: 'text', text: 'Second' }], 'steer')
    expect(api.callsOf('session.prompt')).toMatchObject([
      { requestId: 'phone-1', sessionId: SID, clientTimeZone: 'Europe/Rome' },
      { requestId: 'phone-2', sessionId: SID, clientTimeZone: 'Asia/Tokyo' },
    ])
  } finally { await session.dispose() }
})

it('uses the supplied native identity and time zone for a direct child continuation', async () => {
  withoutBrowserInputs()
  const api = new FakeApiClient()
  const session = new Session(SID, fakeRemote(api), inputs('child'), {
    address: { parentSessionId: PARENT, childSessionId: SID, mode: 'continuable' },
    parentAvailable: true,
  })
  try {
    await session.prompt([{ type: 'text', text: 'Continue' }], 'queue')
    expect(api.callsOf('session.prompt')).toEqual([])
    expect(api.callsOf('subagents.prompt')).toMatchObject([
      { requestId: 'child-1', parentSessionId: PARENT, childSessionId: SID, clientTimeZone: 'Europe/Rome' },
    ])
  } finally { await session.dispose() }
})

it('restores, changes and clears navigation separately for hosts with the same Session id', async () => {
  withoutBrowserInputs()
  const firstCtx = new Context()
  const secondCtx = new Context()
  await Promise.all([firstCtx.plugin(() => undefined), secondCtx.plugin(() => undefined)])
  const firstApi = new FakeApiClient()
  const secondApi = new FakeApiClient()
  const firstSelection = selection({ sessionId: SID })
  const secondSelection = selection({})
  const first = new ClientSessions(firstCtx, fakeRemote(firstApi), { platform: inputs('first'), selection: firstSelection })
  const second = new ClientSessions(secondCtx, fakeRemote(secondApi), { platform: inputs('second'), selection: secondSelection })
  try {
    for (const api of [firstApi, secondApi]) {
      api.onList = () => Promise.resolve(ok({ items: [{ sessionId: SID, updatedAt: 1, running: false, blank: false }] as never[] }))
    }
    await Promise.all([first.refresh(), second.refresh()])
    expect(first.list.getSnapshot().current).toBe(SID)
    expect(second.list.getSnapshot().current).toBeUndefined()
    second.open(SID)
    first.clear()
    expect(firstSelection.getSnapshot()).toEqual({})
    expect(secondSelection.getSnapshot()).toEqual({ sessionId: SID })
    expect(second.list.getSnapshot().current).toBe(SID)
    const pending = second.binding(SID)?.session.beginSubmission({ mode: 'queue', text: 'Second host', attachments: [] })
    expect(pending?.requestId).toBe('second-1')
  } finally { await Promise.all([firstCtx.fiber.dispose(), secondCtx.fiber.dispose()]) }
})
