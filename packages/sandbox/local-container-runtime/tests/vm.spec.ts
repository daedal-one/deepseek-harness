import { brandString } from '@deepseek-ai/dsh-brand'
import type { ConversationWorkspaceId } from '../src/workspace-types.ts'
import { Context } from '@deepseek-ai/cordis'
import { Duplex } from 'node:stream'
import * as processes from '../src/vm-process.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DevelopmentVms, { type Config } from '../src/vm.ts'
import { IncusDevelopmentVms } from '../src/vm-engine.ts'
import type { WorkspaceExecutionRuntime } from '../src/types.ts'

const config: Config = {
  command: '/usr/bin/incus', pythonCommand: '/usr/bin/python3', devicesRoot: '/var/lib/incus/devices',
  project: 'test', storage: 'test', network: 'test', acl: 'test', hostAddresses: ['203.0.113.1'],
  image: 'a'.repeat(64), workspaceUid: 1000, workspaceGid: 1000, maxInstances: 4,
  cpus: 2, memoryBytes: 4096, diskBytes: 8192, timeoutMs: 1000, readinessPollMs: 10, maxOutputBytes: 8192,
  environment: { HOME: '/root', PATH: '/usr/bin:/bin' }, maxLiveProcesses: 4, lifetimeMs: 60000,
}
const id = brandString<ConversationWorkspaceId>('b'.repeat(32))
const contexts: Context[] = []
afterEach(async () => {
  try { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() }
  finally { vi.restoreAllMocks() }
})

async function fixture() {
  const events: string[] = []
  let status = 'Stopped'
  const prototype = IncusDevelopmentVms.prototype
  vi.spyOn(prototype, 'verifyNetwork').mockResolvedValue()
  const exists = vi.spyOn(prototype, 'exists').mockResolvedValue(false)
  const create = vi.spyOn(prototype, 'create').mockImplementation(async () => { events.push('create'); return `dsh-${id}` })
  vi.spyOn(prototype, 'verify').mockResolvedValue()
  const restore = vi.spyOn(prototype, 'restore').mockImplementation(async () => { events.push('restore') })
  const start = vi.spyOn(prototype, 'start').mockImplementation(async () => { events.push('start'); status = 'Running' })
  vi.spyOn(prototype, 'state').mockImplementation(async () => status)
  const freeze = vi.spyOn(prototype, 'freeze').mockImplementation(async () => { events.push('freeze'); status = 'Frozen' })
  vi.spyOn(prototype, 'unfreeze').mockImplementation(async () => { events.push('unfreeze'); status = 'Running' })
  vi.spyOn(prototype, 'checkpoint').mockImplementation(async () => { events.push('checkpoint') })
  vi.spyOn(prototype, 'prune').mockResolvedValue()
  const stop = vi.spyOn(prototype, 'stop').mockImplementation(async () => { events.push('stop'); status = 'Stopped' })
  const base: WorkspaceExecutionRuntime = {
    executionWorld: {}, containerName: 'maintenance',
    executeController: vi.fn(async () => ({ exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) })),
    createProcess: vi.fn(async () => { throw new Error('maintenance must not run guest processes') }),
    cancelProcesses: vi.fn(async () => { events.push('cancel maintenance') }),
    async settle(_timeout, operation) { events.push('maintenance'); return await operation(base.executeController.bind(base)) },
  }
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(DevelopmentVms, config)
  return { ctx, service: ctx.developmentVms, base, events, exists, create, restore, start, freeze, stop }
}

describe('conversation VM lifecycle', () => {
  it('refuses missing acknowledged guest storage before allocating a replacement', async () => {
    const test = await fixture()
    await expect(test.service.open(test.base, id, '/private/source', 3, false, true)).rejects.toThrow('refusing a replacement')
    expect(test.create).not.toHaveBeenCalled()
  })
  it('pairs first source recovery with a stopped-writer disk snapshot before admission', async () => {
    const test = await fixture()
    const guest = await test.service.open(test.base, id, '/private/source', 1, false, false)
    expect(guest.runtime.executionWorld).toBe(test.base.executionWorld)
    expect(test.events).toEqual(['create', 'start', 'freeze', 'checkpoint', 'unfreeze'])
    await guest.dispose(); await guest.dispose()
    expect(test.stop).toHaveBeenCalledTimes(1)
  })
  it('restores a lost RAM generation before guest startup and preserves retained RAM otherwise', async () => {
    const test = await fixture(); test.exists.mockResolvedValue(true)
    await test.service.open(test.base, id, '/private/source', 4, false, true)
    expect(test.events).toEqual(['restore', 'start'])
    test.events.length = 0
    await test.service.open(test.base, brandString<ConversationWorkspaceId>('c'.repeat(32)), '/private/other', 4, true, true)
    expect(test.events).toEqual(['start'])
  })
  it('stops a guest when startup fails and retains the original failure', async () => {
    const test = await fixture(); test.start.mockRejectedValue(new Error('guest boot failed'))
    await expect(test.service.open(test.base, id, '/private/source', 1, false, false)).rejects.toThrow('guest boot failed')
    expect(test.stop).toHaveBeenCalledTimes(1)
  })
  it('freezes around maintenance and resumes service execution only after success', async () => {
    const test = await fixture()
    const guest = await test.service.open(test.base, id, '/private/source', 1, false, false)
    test.events.length = 0
    expect(await guest.runtime.settle(1000, async () => { test.events.push('save'); await guest.runtime.checkpoint?.(2); return 'returned' })).toBe('returned')
    expect(test.events).toEqual(['freeze', 'maintenance', 'save', 'checkpoint', 'unfreeze'])
    expect(test.stop).not.toHaveBeenCalled()
  })
  it('does not run maintenance when the writer barrier fails', async () => {
    const test = await fixture()
    const guest = await test.service.open(test.base, id, '/private/source', 1, false, false)
    test.freeze.mockRejectedValue(new Error('filesystem worker still running'))
    const maintenance = vi.fn()
    await expect(guest.runtime.settle(1000, maintenance)).rejects.toThrow('still running')
    expect(maintenance).not.toHaveBeenCalled()
    await expect(guest.runtime.createProcess({ argv: ['/bin/true'], cwd: '/workspace', environment: {}, tty: false, stdin: false })).rejects.toThrow('being saved')
  })
  it('retains the freeze on failed maintenance and permits an explicit save retry', async () => {
    const test = await fixture()
    const guest = await test.service.open(test.base, id, '/private/source', 1, false, false)
    test.events.length = 0
    await expect(guest.runtime.settle(1000, async () => { throw new Error('disk full') })).rejects.toThrow('disk full')
    expect(test.events).toEqual(['freeze', 'maintenance'])
    await guest.runtime.settle(1000, async () => undefined)
    expect(test.events.at(-1)).toBe('unfreeze')
  })
  it('stops retained guests when their provider fiber is disposed', async () => {
    const test = await fixture()
    await test.service.open(test.base, id, '/private/source', 1, false, false)
    await test.ctx.fiber.dispose()
    expect(test.stop).toHaveBeenCalledTimes(1)
  })
  it('reports the controller deadline even when the terminated command exits successfully', async () => {
    const test = await fixture()
    const guest = await test.service.open(test.base, id, '/private/source', 1, false, false)
    const done = Promise.withResolvers<{ exitCode: number }>()
    const stream = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback() } })
    vi.spyOn(processes, 'createVmProcess').mockResolvedValue({
      id: 'fixture', tty: false, stream, done: done.promise,
      async resize() {}, async signal() {}, async waitForRemoval() { return true },
      async inspect() { return { exitCode: 0, output: '' } },
      async terminate() { stream.push(null); done.resolve({ exitCode: 0 }) },
    })
    await expect(guest.runtime.executeController({ argv: ['/bin/true'], stdin: Buffer.alloc(0),
      maxOutputBytes: 1024, deadlineMs: 1 })).rejects.toThrow('deadline exceeded')
    expect(test.stop).toHaveBeenCalledTimes(1)
  })

})
