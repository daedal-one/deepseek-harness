import { Context } from '@deepseek-ai/cordis'
import * as filesystem from 'node:fs/promises'
import { Duplex } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SharedVmRuntime, { sharedVmId, sharedVmPaths, type SharedVmConfig } from '../src/shared-vm.ts'
import * as engine from '../src/vm-engine.ts'
import * as transport from '../src/vm-process.ts'
import * as git from '../src/shared-git.ts'
import { SharedVmSelection } from '../src/shared-vm-selection.ts'
import type { LocalContainerProcessHandle, LocalContainerProcessRequest } from '../src/types.ts'

vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  lstat: vi.fn(), realpath: vi.fn(), statfs: vi.fn(),
}))

const config: SharedVmConfig = {
  command: '/usr/bin/incus', pythonCommand: '/usr/bin/python3', devicesRoot: '/var/lib/incus/devices',
  project: 'test', storage: 'test', network: 'test', acl: 'test', hostAddresses: ['203.0.113.1'],
  image: 'a'.repeat(64), workspaceUid: 1000, workspaceGid: 1000, maxInstances: 4,
  cpus: 4, memoryBytes: 8 * 1024 ** 3, diskBytes: 64 * 1024 ** 3,
  timeoutMs: 1000, readinessPollMs: 10, maxOutputBytes: 8192,
  environmentId: 'development', workspaceDirectory: '/data/workspace',
  repositories: [{ source: '/repositories/first', path: '/workspace/first' }, { source: '/repositories/second', path: '/workspace/second' }],
  environment: { HOME: '/root', PATH: '/usr/bin:/bin' }, maxLiveProcesses: 4,
}
const contexts: Context[] = []
afterEach(async () => {
  try { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) }
  finally { vi.restoreAllMocks(); vi.useRealTimers() }
})

async function fixture(overrides: Partial<SharedVmConfig> = {}, beforeMount?: () => void) {
  vi.mocked(filesystem.lstat).mockResolvedValue({ isDirectory: () => true } as Awaited<ReturnType<typeof filesystem.lstat>>)
  vi.mocked(filesystem.realpath).mockImplementation(async path => String(path))
  vi.mocked(filesystem.statfs).mockResolvedValue({ type: 0xef53 } as Awaited<ReturnType<typeof filesystem.statfs>>)
  const command = vi.fn(async () => Buffer.alloc(0))
  vi.spyOn(engine, 'incusCommand').mockReturnValue(command)
  const prototype = engine.IncusDevelopmentVms.prototype
  vi.spyOn(prototype, 'verifyNetwork').mockResolvedValue()
  const verify = vi.spyOn(prototype, 'verify').mockResolvedValue()
  const exists = vi.spyOn(prototype, 'exists').mockResolvedValue(true)
  vi.spyOn(prototype, 'state').mockResolvedValue('Running')
  const start = vi.spyOn(prototype, 'start').mockResolvedValue()
  const stop = vi.spyOn(prototype, 'stop').mockResolvedValue()
  const create = vi.spyOn(prototype, 'create').mockRejectedValue(new Error('automatic creation forbidden'))
  const process = vi.spyOn(transport, 'createVmProcess')
  beforeMount?.()
  const ctx = new Context(); contexts.push(ctx)
  const fiber = await ctx.plugin(SharedVmRuntime, { ...config, ...overrides })
  const runtime = ctx.executionRuntime
  return { ctx, fiber, runtime, command, verify, exists, start, stop, create, process }
}

function handle() {
  const settled = Promise.withResolvers<{ exitCode: number }>()
  const stream = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback() }, final(callback) { callback() } })
  const finish = () => { stream.push(null); settled.resolve({ exitCode: 0 }) }
  const terminate = vi.fn(async () => { finish() })
  const value: LocalContainerProcessHandle = {
    id: 'test-command', stream, tty: false, done: settled.promise, terminate,
    async resize() {}, async signal() {}, async inspect() { return { exitCode: 0, output: '' } },
    async waitForRemoval() { await settled.promise; return true },
  }
  return { value, finish, terminate }
}

const request: LocalContainerProcessRequest = { argv: ['/bin/true'], cwd: '/workspace/first', environment: {}, tty: false, stdin: false }

describe('shared environment directory mapping', () => {
  it('keeps one VM identity across sessions and separates environments', () => {
    expect(sharedVmId('development')).toBe(sharedVmId('development'))
    expect(sharedVmId('development')).not.toBe(sharedVmId('production'))
    expect(() => sharedVmId('../escape')).toThrow('identity')
  })

  it('maps only admitted directories and preserves guest and relative paths', () => {
    const map = sharedVmPaths(config)
    expect(map('/repositories/first/src/main.ts')).toBe('/workspace/first/src/main.ts')
    expect(map('/repositories/second')).toBe('/workspace/second')
    expect(map('/data/workspace/assets')).toBe('/workspace/assets')
    expect(map('/workspace/first')).toBe('/workspace/first')
    expect(map('src/main.ts')).toBe('src/main.ts')
    for (const path of ['/etc/passwd', '/repositories/first-neighbor', '/repositories/first/../../secret', '/workspace/../../secret', 'bad\0path']) {
      expect(() => map(path)).toThrow()
    }
  })

  it.each([
    { source: '/repositories/first', path: '/workspace/duplicate' },
    { source: '/repositories/first/nested', path: '/workspace/nested' },
    { source: '/other', path: '/workspace/first/nested' },
    { source: '/other', path: '/outside' },
    { source: '/', path: '/workspace/root' },
    { source: '/other/', path: '/workspace/other' },
  ])('rejects ambiguous or overly broad mounts: %j', (mount) => {
    expect(() => sharedVmPaths({ ...config, repositories: [...config.repositories, mount] })).toThrow()
  })
})

describe('shared VM attachment', () => {
  it('serializes concurrent selections, publishes their shared mapping, and reuses the committed mount', async () => {
    let mounts: engine.VmDirectoryMount[] = []
    vi.spyOn(SharedVmSelection.prototype, 'open').mockResolvedValue()
    vi.spyOn(SharedVmSelection.prototype, 'recover').mockResolvedValue()
    vi.spyOn(SharedVmSelection.prototype, 'mounts', 'get').mockImplementation(() => mounts)
    const entered = Promise.withResolvers<undefined>(); const ready = Promise.withResolvers<undefined>()
    const select = vi.spyOn(SharedVmSelection.prototype, 'select').mockImplementation(async (source) => {
      entered.resolve(undefined); await ready.promise
      mounts = [{ source, path: '/workspace/selected-test' }]
    })
    const close = vi.spyOn(SharedVmSelection.prototype, 'close').mockResolvedValue()
    const test = await fixture({ workspaceSelection: { roots: ['/repositories'], directory: '/private/state', maxMounts: 4, maxStateBytes: 4096 } })
    await test.runtime.ensureReady()
    const first = test.ctx.serial('workspace/prepare', '/repositories/selected', 'workspace')
    const second = test.ctx.serial('workspace/prepare', '/repositories/selected', 'workspace')
    try {
      await entered.promise
      expect(() => test.runtime.executionPath('/repositories/selected')).toThrow('configured workspace')
      expect(select).toHaveBeenCalledOnce()
    } finally { ready.resolve(undefined); await Promise.all([first, second]) }
    expect(test.runtime.executionPath('/repositories/selected/file.txt')).toBe('/workspace/selected-test/file.txt')
    expect(test.runtime.executionPath('/repositories/first')).toBe('/workspace/first')
    expect(select).toHaveBeenCalledOnce()
    await test.fiber.dispose()
    expect(close).toHaveBeenCalledOnce()
    expect(test.stop).not.toHaveBeenCalled()
  })

  it('rejects an unmounted Agent before publication and removes the listener on disposal', async () => {
    const test = await fixture()
    const payload = (cwd?: string) => ({ agent: { session: { header: { cwd } } } }) as never
    await expect(test.ctx.serial('agent/prepare', payload('/repositories/first'))).resolves.toBeUndefined()
    await expect(test.ctx.serial('agent/prepare', payload())).resolves.toBeUndefined()
    await expect(test.ctx.serial('agent/prepare', payload('/unmounted'))).rejects.toThrow('select this workspace')
    await expect(test.ctx.serial('agent/prepare', payload('relative'))).rejects.toThrow('select this workspace')
    expect(test.process).not.toHaveBeenCalled()
    await test.fiber.dispose()
    await expect(test.ctx.serial('agent/prepare', payload('/unmounted'))).resolves.toBeUndefined()
  })

  it('reuses configured selections and rejects unmounted selections before tool execution', async () => {
    const test = await fixture()
    await expect(test.ctx.serial('workspace/prepare', '/repositories/first', 'workspace')).resolves.toBeUndefined()
    await expect(test.ctx.serial('workspace/prepare', '/repositories/unmounted', 'workspace')).rejects.toThrow('workspaceSelection')
    await expect(test.ctx.serial('workspace/prepare', '/workspace/guest-only', 'workspace')).rejects.toThrow('workspaceSelection')
    await expect(test.ctx.serial('workspace/prepare', '/workspace/guest-only', 'session')).resolves.toBeUndefined()
    await expect(test.ctx.serial('workspace/prepare', '/repositories/first/file', 'workspace')).resolves.toBeUndefined()
    await expect(test.ctx.serial('workspace/prepare', 'relative', 'session')).rejects.toThrow('fully qualified')
    expect(test.process).not.toHaveBeenCalled()
    await test.fiber.dispose()
    await expect(test.ctx.serial('workspace/prepare', '/repositories/unmounted', 'workspace')).resolves.toBeUndefined()
  })

  it('passes configured authorization only to ordinary commands', async () => {
    const authorize = vi.fn(async () => ['GIT_CONFIG_COUNT=1', 'GIT_CONFIG_KEY_0=credential.helper', 'GIT_CONFIG_VALUE_0='])
    const test = await fixture({}, () => vi.spyOn(git, 'sharedGitAuthorization').mockReturnValue(authorize))
    const command = handle(); const controller = handle()
    test.process.mockResolvedValueOnce(command.value).mockResolvedValueOnce(controller.value)
    await test.runtime.createProcess(request)
    const pending = test.runtime.executeController({ argv: ['/bin/true'], stdin: Buffer.alloc(0), maxOutputBytes: 4, deadlineMs: 1000 })
    controller.finish(); await pending
    expect(authorize).toHaveBeenCalledOnce()
    expect(test.process.mock.calls[0]?.[4]).toEqual(await authorize())
    expect(test.process.mock.calls[1]?.[4]).toEqual([])
  })

  it('releases admission after failed credential issuance without launching a command', async () => {
    const authorize = vi.fn<() => Promise<string[]>>().mockRejectedValueOnce(new Error('issuer unavailable')).mockResolvedValue([])
    const test = await fixture({ maxLiveProcesses: 1 }, () => vi.spyOn(git, 'sharedGitAuthorization').mockReturnValue(authorize))
    await expect(test.runtime.createProcess(request)).rejects.toThrow('issuer unavailable')
    expect(test.process).not.toHaveBeenCalled()
    const command = handle(); test.process.mockResolvedValue(command.value)
    await test.runtime.createProcess(request)
    expect(test.process).toHaveBeenCalledOnce()
  })

  it.each(['cancel', 'dispose'] as const)('prevents launch after %s during bounded credential issuance', async (action) => {
    const entered = Promise.withResolvers<undefined>(); const issued = Promise.withResolvers<string[]>()
    const test = await fixture({ maxLiveProcesses: 1 }, () => vi.spyOn(git, 'sharedGitAuthorization').mockReturnValue(() => { entered.resolve(undefined); return issued.promise }))
    const cancel = new AbortController()
    const pending = test.runtime.createProcess({ ...request, signal: cancel.signal })
    const rejected = expect(pending).rejects.toThrow(action === 'cancel' ? 'cancelled' : 'closing')
    await entered.promise
    let disposal: Promise<unknown> | undefined
    try {
      if (action === 'cancel') cancel.abort(new Error('cancelled'))
      else { disposal = test.fiber.dispose(); await Promise.resolve() }
    } finally { issued.resolve([]) }
    await rejected; await disposal
    expect(test.process).not.toHaveBeenCalled()
  })

  it('verifies every mount without importing or saving repositories', async () => {
    const test = await fixture()
    await test.runtime.ensureReady()
    expect(test.verify).toHaveBeenCalledWith(sharedVmId(config.environmentId), config.workspaceDirectory, config.repositories)
    expect(test.command.mock.calls).toHaveLength(3)
    expect(test.start).not.toHaveBeenCalled()
    expect(test.create).not.toHaveBeenCalled()
    await test.fiber.dispose()
    expect(test.stop).not.toHaveBeenCalled()
  })

  it('reports a missing VM without allocating an empty replacement', async () => {
    const test = await fixture({}, () => vi.spyOn(engine.IncusDevelopmentVms.prototype, 'exists').mockResolvedValue(false))
    await expect(test.runtime.ensureReady()).rejects.toThrow('provision dsh-')
    expect(test.create).not.toHaveBeenCalled()
  })

  it('rejects configuration drift without restarting the VM', async () => {
    const test = await fixture({}, () => vi.spyOn(engine.IncusDevelopmentVms.prototype, 'verify').mockRejectedValue(new Error('mount differs')))
    await expect(test.runtime.ensureReady()).rejects.toThrow('mount differs')
    expect(test.start).not.toHaveBeenCalled()
    expect(test.stop).not.toHaveBeenCalled()
  })

  it('rejects RAM-backed directories before contacting Incus', async () => {
    const test = await fixture({}, () => vi.mocked(filesystem.statfs).mockResolvedValue(
      { type: 0x01021994 } as Awaited<ReturnType<typeof filesystem.statfs>>,
    ))
    await expect(test.runtime.ensureReady()).rejects.toThrow('disk-backed')
    expect(test.verify).not.toHaveBeenCalled()
  })

  it('starts an existing stopped VM and preserves it on disposal', async () => {
    const test = await fixture({}, () => vi.spyOn(engine.IncusDevelopmentVms.prototype, 'state').mockResolvedValue('Stopped'))
    await test.runtime.ensureReady()
    expect(test.start).toHaveBeenCalledOnce()
    await test.fiber.dispose()
    expect(test.stop).not.toHaveBeenCalled()
  })

  it('releases only attached commands when the harness closes', async () => {
    const test = await fixture()
    const first = handle(); const second = handle()
    test.process.mockResolvedValueOnce(first.value).mockResolvedValueOnce(second.value)
    const a = await test.runtime.createProcess(request)
    await test.runtime.createProcess(request)
    await a.terminate()
    expect(second.terminate).not.toHaveBeenCalled()
    expect(test.process.mock.calls[0]?.[2].cwd).toBe('/workspace/first')
    await test.fiber.dispose()
    expect(second.terminate).toHaveBeenCalledOnce()
    expect(test.stop).not.toHaveBeenCalled()
    await expect(test.runtime.createProcess(request)).rejects.toThrow('closing')
  })

  it('waits for a racing allocation and terminates its command before disposal completes', async () => {
    const test = await fixture()
    await test.runtime.ensureReady()
    const entered = Promise.withResolvers<undefined>()
    const allocated = Promise.withResolvers<LocalContainerProcessHandle>()
    test.process.mockImplementation(async () => { entered.resolve(undefined); return await allocated.promise })
    const pending = test.runtime.createProcess(request)
    const rejected = expect(pending).rejects.toThrow('closing')
    await entered.promise
    const disposal = test.fiber.dispose()
    const owned = handle(); allocated.resolve(owned.value)
    await rejected; await disposal
    expect(owned.terminate).toHaveBeenCalled()
    expect(test.stop).not.toHaveBeenCalled()
  })

  it('queues excess commands behind allocating and running owners in arrival order', async () => {
    const test = await fixture({ maxLiveProcesses: 1 })
    await test.runtime.ensureReady()
    const entered = Promise.withResolvers<undefined>(); const allocated = Promise.withResolvers<LocalContainerProcessHandle>()
    const first = handle(); const second = handle(); const third = handle()
    test.process.mockImplementationOnce(async () => { entered.resolve(undefined); return await allocated.promise })
      .mockResolvedValueOnce(second.value).mockResolvedValueOnce(third.value)
    const pending = test.runtime.createProcess(request)
    await entered.promise
    const waiting = test.runtime.createProcess(request); const last = test.runtime.createProcess(request)
    allocated.resolve(first.value); await pending
    expect(test.process).toHaveBeenCalledOnce()
    first.finish(); await expect(waiting).resolves.toBe(second.value)
    expect(test.process).toHaveBeenCalledTimes(2)
    second.finish(); await expect(last).resolves.toBe(third.value)
    third.finish()
  })

  it.each(['caller', 'dispose'] as const)('withdraws a queued command on %s without launching it', async (kind) => {
    const test = await fixture({ maxLiveProcesses: 1 }); const first = handle()
    test.process.mockResolvedValueOnce(first.value)
    await test.runtime.createProcess(request)
    const cancel = new AbortController()
    const waiting = test.runtime.createProcess({ ...request, signal: cancel.signal })
    const rejected = expect(waiting).rejects.toThrow(kind === 'caller' ? 'withdrawn' : 'closing')
    if (kind === 'caller') cancel.abort(new Error('withdrawn'))
    else await test.fiber.dispose()
    await rejected
    expect(test.process).toHaveBeenCalledOnce()
    if (kind === 'caller') expect(first.terminate).not.toHaveBeenCalled()
    first.finish()
  })

  it.each(['returned handle', 'failed allocation'] as const)('retains capacity after unconfirmed cleanup of a %s', async (kind) => {
    const test = await fixture({ maxLiveProcesses: 1 }); const first = handle()
    vi.spyOn(test.ctx.logger, 'error').mockImplementation(() => {})
    if (kind === 'failed allocation') {
      test.process.mockRejectedValueOnce(new transport.VmProcessCleanupUnconfirmed('cleanup unconfirmed'))
      await expect(test.runtime.createProcess(request)).rejects.toThrow('unconfirmed')
    } else {
      test.process.mockResolvedValueOnce({ ...first.value, waitForRemoval: async () => false })
      await test.runtime.createProcess(request); first.finish()
    }
    const cancel = new AbortController()
    const waiting = test.runtime.createProcess({ ...request, signal: cancel.signal })
    const rejected = expect(waiting).rejects.toThrow('withheld')
    // A subsequent admitted allocation would have called the provider before this barrier.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(test.process).toHaveBeenCalledOnce()
    cancel.abort(new Error('withheld')); await rejected
  })

  it('starts controller execution deadlines after queued capacity becomes available', async () => {
    const test = await fixture({ maxLiveProcesses: 1 }); const first = handle(); const controller = handle()
    test.process.mockResolvedValueOnce(first.value).mockResolvedValueOnce(controller.value)
    await test.runtime.createProcess(request)
    vi.useFakeTimers()
    try {
      const waiting = test.runtime.executeController({ argv: ['/bin/true'], stdin: Buffer.alloc(0), maxOutputBytes: 64, deadlineMs: 1000 })
      await vi.advanceTimersByTimeAsync(2000)
      expect(test.process).toHaveBeenCalledOnce()
      first.finish(); controller.finish()
      await expect(waiting).resolves.toMatchObject({ exitCode: 0 })
    } finally { vi.useRealTimers() }
  })

  it('rejects controller overflow while unrelated work continues', async () => {
    const test = await fixture()
    const other = handle(); const controller = handle()
    test.process.mockResolvedValueOnce(other.value).mockResolvedValueOnce(controller.value)
    await test.runtime.createProcess(request)
    const pending = test.runtime.executeController({ argv: ['/bin/true'], stdin: Buffer.alloc(0), maxOutputBytes: 4, deadlineMs: 1000 })
    const header = Buffer.alloc(8); header[0] = 1; header.writeUInt32BE(5, 4)
    controller.value.stream.push(header)
    await expect(pending).rejects.toThrow('output limit')
    expect(controller.terminate).toHaveBeenCalledOnce()
    expect(other.terminate).not.toHaveBeenCalled()
    expect(test.stop).not.toHaveBeenCalled()
  })

  it('decodes split stdout and stderr frames without changing command ownership', async () => {
    const test = await fixture(); const owned = handle()
    test.process.mockResolvedValue(owned.value)
    const operation = test.runtime.executeController({ argv: ['/bin/true'], stdin: Buffer.alloc(0), maxOutputBytes: 64, deadlineMs: 1000 })
    const frame = (channel: number, content: string) => {
      const bytes = Buffer.from(content); const header = Buffer.alloc(8)
      header[0] = channel; header.writeUInt32BE(bytes.length, 4)
      return Buffer.concat([header, bytes])
    }
    const output = frame(1, 'result'); const error = frame(2, 'diagnostic')
    owned.value.stream.push(output.subarray(0, 10))
    owned.value.stream.push(Buffer.concat([output.subarray(10), error]))
    owned.finish()
    await expect(operation).resolves.toMatchObject({ exitCode: 0, stdout: Buffer.from('result'), stderr: Buffer.from('diagnostic') })
  })

  it.each([
    { frame: [3, 0, 0, 0, 0, 0, 0, 0], reason: 'invalid controller frame' },
    { frame: [1, 1, 0, 0, 0, 0, 0, 0], reason: 'invalid controller frame' },
    { frame: [1, 0, 1, 0, 0, 0, 0, 0], reason: 'invalid controller frame' },
    { frame: [1, 0, 0, 1, 0, 0, 0, 0], reason: 'invalid controller frame' },
    { frame: [1], reason: 'stream incomplete' },
  ])('rejects malformed or unfinished controller transport: $frame', async ({ frame, reason }) => {
    const test = await fixture(); const owned = handle(); test.process.mockResolvedValue(owned.value)
    const operation = test.runtime.executeController({ argv: ['/bin/true'], stdin: Buffer.alloc(0), maxOutputBytes: 64, deadlineMs: 1000 })
    owned.value.stream.push(Buffer.from(frame)); owned.finish()
    await expect(operation).rejects.toThrow(reason)
  })

  it.each([
    { exitCode: null },
    { exitCode: 0, error: 'provider failure' },
  ])('rejects a failed controller outcome: %j', async (result) => {
    const test = await fixture(); const owned = handle()
    test.process.mockResolvedValue({ ...owned.value, done: Promise.resolve(result) })
    const operation = test.runtime.executeController({ argv: ['/bin/true'], stdin: Buffer.alloc(0), maxOutputBytes: 64, deadlineMs: 1000 })
    owned.finish(); await expect(operation).rejects.toThrow('controller failed')
  })

  it.each(['deadline', 'caller'] as const)('reports %s cancellation after joining its controller', async (kind) => {
    const test = await fixture(); const owned = handle(); const caller = new AbortController()
    const entered = Promise.withResolvers<undefined>()
    test.process.mockImplementation(async (_config, _name, request) => {
      request.signal?.addEventListener('abort', owned.finish, { once: true }); entered.resolve(undefined)
      return owned.value
    })
    vi.useFakeTimers()
    try {
      const operation = test.runtime.executeController({ argv: ['/bin/true'], stdin: Buffer.alloc(0), maxOutputBytes: 64, deadlineMs: 1000, ...kind === 'caller' ? { signal: caller.signal } : {} })
      const rejected = expect(operation).rejects.toThrow(kind === 'deadline' ? 'deadline' : 'aborted')
      await entered.promise
      if (kind === 'caller') caller.abort()
      else await vi.advanceTimersByTimeAsync(1000)
      await rejected
      expect(owned.terminate).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers() }
  })

  it('retains both controller and cleanup failures', async () => {
    const test = await fixture(); const owned = handle()
    owned.terminate.mockRejectedValueOnce(new Error('cleanup failed'))
    test.process.mockResolvedValue(owned.value)
    const operation = test.runtime.executeController({ argv: ['/bin/true'], stdin: Buffer.alloc(0), maxOutputBytes: 64, deadlineMs: 1000 })
    owned.value.stream.push(Buffer.from([3, 0, 0, 0, 0, 0, 0, 0])); owned.finish()
    await expect(operation).rejects.toThrow('controller cleanup unconfirmed')
  })

  it('rejects invalid command bounds and environment configuration', async () => {
    await expect(fixture({ maxLiveProcesses: 0 })).rejects.toThrow('invalid command limit')
    await expect(fixture({ environment: { SECRET: 'private' } })).rejects.toThrow('secret command environment')
    await expect(fixture({ gitRemotes: [] })).resolves.toHaveProperty('runtime')
    const test = await fixture()
    await expect(test.runtime.executeController({ argv: ['/bin/true'], stdin: Buffer.alloc(0), maxOutputBytes: 0, deadlineMs: 1 })).rejects.toThrow('invalid controller bounds')
    await expect(test.runtime.createProcess({ ...request, environment: { INVALID: 'line\nfeed' } })).rejects.toThrow('command environment')
  })

  it('reports unconfirmed command removal during teardown without stopping the VM', async () => {
    const test = await fixture(); const owned = handle()
    const errors = vi.spyOn(test.ctx.logger, 'error').mockImplementation(() => {})
    test.process.mockResolvedValue({ ...owned.value, waitForRemoval: async () => false })
    await test.runtime.createProcess(request)
    await test.fiber.dispose()
    expect(errors).toHaveBeenCalled()
    expect(test.stop).not.toHaveBeenCalled()
  })

  it('rejects a non-running retained VM without restarting or replacing it', async () => {
    const test = await fixture({}, () => vi.spyOn(engine.IncusDevelopmentVms.prototype, 'state').mockResolvedValue('Frozen'))
    await expect(test.runtime.ensureReady()).rejects.toThrow('operator action')
    expect(test.start).not.toHaveBeenCalled()
  })

  it('joins initial VM verification when disposal starts during opening', async () => {
    const entered = Promise.withResolvers<undefined>(); const release = Promise.withResolvers<undefined>()
    const test = await fixture({}, () => vi.spyOn(engine.IncusDevelopmentVms.prototype, 'verify').mockImplementation(async () => {
      entered.resolve(undefined); await release.promise
    }))
    const readiness = expect(test.runtime.ensureReady()).rejects.toThrow('closing')
    await entered.promise
    const disposal = test.fiber.dispose(); release.resolve(undefined)
    await readiness; await disposal
    expect(test.start).not.toHaveBeenCalled()
  })

  it('rejects controller allocation failure before launching a process', async () => {
    const test = await fixture()
    test.process.mockRejectedValueOnce(new Error('allocation failed'))
    await expect(test.runtime.executeController({ argv: ['/bin/true'], stdin: Buffer.alloc(0), maxOutputBytes: 64, deadlineMs: 1000 })).rejects.toThrow('allocation failed')
  })

  it('releases a command slot when the provider rejects its completion', async () => {
    const test = await fixture({ maxLiveProcesses: 1 }); const owned = handle()
    const completed = Promise.withResolvers<{ exitCode: number }>()
    test.process.mockResolvedValueOnce({ ...owned.value, done: completed.promise })
    await test.runtime.createProcess(request)
    const rejected = expect(completed.promise).rejects.toThrow('transport failed')
    completed.reject(new Error('transport failed')); await rejected; owned.finish()
    const next = handle(); test.process.mockResolvedValueOnce(next.value)
    await expect(test.runtime.createProcess(request)).resolves.toBe(next.value)
    next.finish()
  })
})
