import { brandString } from '@deepseek-ai/dsh-brand'
import type { ConversationWorkspaceId } from '../src/workspace-types.ts'
import { Context } from '@deepseek-ai/cordis'
import { Duplex } from 'node:stream'
import * as processes from '../src/vm-process.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DevelopmentVms, { type Config, type DevelopmentVmOpenRequest } from '../src/vm.ts'
import { IncusDevelopmentVms } from '../src/vm-engine.ts'
import type { LocalContainerProcessHandle, WorkspaceExecutionRuntime } from '../src/types.ts'

const config: Config = {
  command: '/usr/bin/incus', pythonCommand: '/usr/bin/python3', devicesRoot: '/var/lib/incus/devices',
  project: 'test', storage: 'test', network: 'test', acl: 'test', hostAddresses: ['203.0.113.1'],
  image: 'a'.repeat(64), workspaceUid: 1000, workspaceGid: 1000, maxInstances: 4,
  cpus: 2, memoryBytes: 4096, diskBytes: 8192, timeoutMs: 1000, readinessPollMs: 10, maxOutputBytes: 8192,
  environment: { HOME: '/root', PATH: '/usr/bin:/bin' }, maxLiveProcesses: 4, lifetimeMs: 60000,
}
const id = brandString<ConversationWorkspaceId>('b'.repeat(32))
const checkpointHash = 'c'.repeat(64)
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
  vi.spyOn(prototype, 'verifyIdentity').mockResolvedValue()
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
    async settle(_timeout, operation, quiesce) { await quiesce?.(); events.push('maintenance'); return await operation(base.executeController.bind(base)) },
  }
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(DevelopmentVms, config)
  const request = (overrides: Partial<DevelopmentVmOpenRequest> = {}): DevelopmentVmOpenRequest => ({
    id, directory: '/private/source', generation: 1, checkpointHash, retained: false, ...overrides,
  })
  return { ctx, service: ctx.developmentVms, base, events, exists, create, restore, start, freeze, stop, request }
}

function processHandle(onInput?: () => void): LocalContainerProcessHandle {
  const done = Promise.withResolvers<{ exitCode: number }>()
  const stream = new Duplex({
    read() {},
    write(_chunk, _encoding, callback) { onInput?.(); callback() },
    final(callback) { callback() },
  })
  queueMicrotask(() => { stream.push(null); done.resolve({ exitCode: 0 }) })
  return {
    id: 'fixture', tty: false, stream, done: done.promise,
    async resize() {}, async signal() {}, async waitForRemoval() { return true },
    async inspect() { return { exitCode: 0, output: '' } },
    async terminate() { stream.push(null); done.resolve({ exitCode: 0 }) },
  }
}

describe('conversation VM lifecycle', () => {
  it('refuses missing acknowledged guest storage before allocating a replacement', async () => {
    const test = await fixture()
    await expect(test.service.open(test.base, test.request({ reference: test.service.identity, generation: 3 }))).rejects.toThrow('refusing a replacement')
    expect(test.create).not.toHaveBeenCalled()
  })

  it('pairs first source recovery with a stopped-writer disk snapshot before admission', async () => {
    const test = await fixture()
    const guest = await test.service.open(test.base, test.request())
    expect(guest.runtime.executionWorld).toBe(test.base.executionWorld)
    expect(test.events).toEqual(['create', 'start', 'freeze', 'checkpoint', 'unfreeze'])
    expect(IncusDevelopmentVms.prototype.checkpoint).toHaveBeenCalledWith(id, 1, checkpointHash)
    await guest.dispose(); await guest.dispose()
    expect(test.stop).toHaveBeenCalledTimes(1)
  })

  it('restores a lost RAM generation before guest startup and preserves retained RAM otherwise', async () => {
    const test = await fixture(); test.exists.mockResolvedValue(true)
    await test.service.open(test.base, test.request({ generation: 4, reference: test.service.identity }))
    expect(test.events).toEqual(['restore', 'start'])
    expect(test.restore).toHaveBeenCalledWith(id, 4, checkpointHash, '/private/source')
    test.events.length = 0
    await test.service.open(test.base, test.request({ id: brandString<ConversationWorkspaceId>('c'.repeat(32)), directory: '/private/other', generation: 4, retained: true, reference: test.service.identity }))
    expect(test.events).toEqual(['start'])
  })

  it('stops a guest when startup fails and retains the original failure', async () => {
    const test = await fixture(); test.start.mockRejectedValue(new Error('guest boot failed'))
    await expect(test.service.open(test.base, test.request())).rejects.toThrow('guest boot failed')
    expect(test.stop).toHaveBeenCalledTimes(1)
  })

  it('freezes around maintenance and resumes service execution only after successful checkpointing', async () => {
    const test = await fixture()
    const guest = await test.service.open(test.base, test.request())
    test.events.length = 0
    expect(await guest.runtime.settle(1000, async () => { test.events.push('save'); await guest.runtime.checkpoint?.(2, 'd'.repeat(64)); return 'returned' }, async () => { test.events.push('quiesce') })).toBe('returned')
    expect(test.events).toEqual(['quiesce', 'freeze', 'maintenance', 'save', 'checkpoint', 'unfreeze'])
    expect(test.stop).not.toHaveBeenCalled()
  })

  it('does not run maintenance when the writer barrier fails', async () => {
    const test = await fixture()
    const guest = await test.service.open(test.base, test.request())
    test.freeze.mockRejectedValue(new Error('filesystem worker still running'))
    const maintenance = vi.fn()
    await expect(guest.runtime.settle(1000, maintenance)).rejects.toThrow('still running')
    expect(maintenance).not.toHaveBeenCalled()
    await expect(guest.runtime.createProcess({ argv: ['/bin/true'], cwd: '/workspace', environment: {}, tty: false, stdin: false })).rejects.toThrow('being saved')
  })

  it('retains the freeze on failed maintenance and permits an explicit save retry', async () => {
    const test = await fixture()
    const guest = await test.service.open(test.base, test.request())
    test.events.length = 0
    await expect(guest.runtime.settle(1000, async () => { throw new Error('disk full') })).rejects.toThrow('disk full')
    expect(test.events).toEqual(['freeze', 'maintenance'])
    await guest.runtime.settle(1000, async () => undefined)
    expect(test.events.at(-1)).toBe('unfreeze')
    expect(test.freeze).toHaveBeenCalledTimes(2)
  })

  it('issues Git authorization for every guest process but never for maintenance controllers', async () => {
    const test = await fixture()
    const firstGrant = ['GIT_CONFIG_COUNT=1', 'GIT_CONFIG_KEY_0=http.https://github.example/org/repo.git/.extraHeader', 'GIT_CONFIG_VALUE_0=Authorization: Basic Zmlyc3Q=']
    const secondGrant = ['GIT_CONFIG_COUNT=1', 'GIT_CONFIG_KEY_0=http.https://github.example/org/repo.git/.extraHeader', 'GIT_CONFIG_VALUE_0=Authorization: Basic c2Vjb25k']
    const authorize = vi.fn()
      .mockResolvedValueOnce(firstGrant)
      .mockResolvedValueOnce(secondGrant)
      .mockRejectedValueOnce(new Error('grant expired'))
    const create = vi.spyOn(processes, 'createVmProcess').mockImplementation(async () => processHandle())
    const guest = await test.service.open(test.base, test.request({ authorize }))
    const first = await guest.runtime.createProcess({ argv: ['/usr/bin/git', 'status'], cwd: '/workspace', environment: {}, tty: false, stdin: false })
    await first.done
    await guest.runtime.executeController({ argv: ['/bin/true'], stdin: Buffer.alloc(0), maxOutputBytes: 1024, deadlineMs: 1000 })
    const second = await guest.runtime.createProcess({ argv: ['/usr/bin/git', 'fetch'], cwd: '/workspace', environment: {}, tty: false, stdin: false })
    await second.done
    await expect(guest.runtime.createProcess({ argv: ['/usr/bin/git', 'push'], cwd: '/workspace', environment: {}, tty: false, stdin: false }))
      .rejects.toThrow('grant expired')
    expect(authorize).toHaveBeenCalledTimes(3)
    expect(create.mock.calls[0]?.[4]).toEqual(firstGrant)
    expect(create.mock.calls[1]?.[4]).toEqual([])
    expect(create.mock.calls[2]?.[4]).toEqual(secondGrant)
    expect(create).toHaveBeenCalledTimes(3)
    expect(test.stop).toHaveBeenCalledOnce()
    expect(JSON.stringify(test.service.identity)).not.toContain('GIT_CONFIG')
    expect(JSON.stringify(test.service.identity)).not.toContain('Zmlyc3Q')
  })

  it('stops retained guests when their provider fiber is disposed', async () => {
    const test = await fixture()
    await test.service.open(test.base, test.request())
    await test.ctx.fiber.dispose()
    expect(test.stop).toHaveBeenCalledTimes(1)
  })

  it('reports the controller deadline even when the terminated command exits successfully', async () => {
    const test = await fixture()
    const guest = await test.service.open(test.base, test.request())
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
