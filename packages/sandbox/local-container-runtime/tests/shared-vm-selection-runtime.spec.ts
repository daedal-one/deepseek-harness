import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareWorkspaceExecution } from '@deepseek-ai/dsh-workspace'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { boot } from '@deepseek-ai/dsh-app-boot'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { writeFile } from 'node:fs/promises'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import SharedVmRuntime, { type SharedVmConfig } from '../src/shared-vm.ts'
import * as engine from '../src/vm-engine.ts'
import { SharedVmSelection } from '../src/shared-vm-selection.ts'

vi.mock('node:fs/promises', async original => ({
  ...await original<typeof import('node:fs/promises')>(),
  statfs: vi.fn(async () => ({ type: 0xef53 })),
}))

const contexts: Context[] = []; const directories: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  vi.restoreAllMocks()
})

async function fixture(catalogue = false) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'dsh-mount-runtime-')))
  directories.push(directory)
  const root = join(directory, 'projects'); const workspace = join(directory, 'workspace'); const state = join(directory, 'state')
  await Promise.all([mkdir(root), mkdir(workspace), mkdir(state, { mode: 0o700 })])
  const source = join(root, 'selected'); await mkdir(source)
  const portal = join(directory, 'catalogue'); await mkdir(portal)
  const exportsState = join(state, 'exports.json'); await writeFile(exportsState, '[]')
  const config: SharedVmConfig = {
    command: '/usr/bin/incus', pythonCommand: '/usr/bin/python3', devicesRoot: '/var/lib/incus/devices',
    project: 'test', storage: 'test', network: 'test', acl: 'test', hostAddresses: ['203.0.113.1'],
    image: 'a'.repeat(64), workspaceUid: 1000, workspaceGid: 1000, maxInstances: 4,
    cpus: 4, memoryBytes: 8 * 1024 ** 3, diskBytes: 64 * 1024 ** 3,
    timeoutMs: 10000, readinessPollMs: 1, maxOutputBytes: 8192,
    environmentId: 'selection-runtime', workspaceDirectory: workspace,
    repositories: catalogue ? [{ source: portal, path: '/workspace/projects' }] : [],
    ...catalogue ? { directoryExports: { command: process.execPath,
      args: [fileURLToPath(new URL('./fixtures/directory-exports.mjs', import.meta.url)), exportsState, '/workspace/projects', ''],
      source: portal, path: '/workspace/projects', directory: state, timeoutMs: 30000, maxOutputBytes: 8192 } }
      : { workspaceSelection: { roots: [root], directory: state, maxMounts: 4, maxStateBytes: 8192 } },
    environment: { HOME: '/root', PATH: '/usr/bin:/bin' }, maxLiveProcesses: 4,
  }
  const mounts: engine.VmDirectoryMount[] = [...config.repositories]
  let failReadiness = 0
  const command = vi.fn(async (args: readonly string[]) => {
    if (args[0] === 'config') {
      mounts.push({ source: args.find(value => value.startsWith('source='))!.slice(7), path: args.find(value => value.startsWith('path='))!.slice(5) })
    } else if (args.at(-1)?.startsWith('/workspace/selected-') && failReadiness-- > 0) {
      throw new Error('guest mount not ready')
    }
    return Buffer.alloc(0)
  })
  vi.spyOn(engine, 'incusCommand').mockReturnValue(command)
  vi.spyOn(engine.IncusDevelopmentVms.prototype, 'verifyNetwork').mockResolvedValue()
  vi.spyOn(engine.IncusDevelopmentVms.prototype, 'exists').mockResolvedValue(true)
  vi.spyOn(engine.IncusDevelopmentVms.prototype, 'state').mockResolvedValue('Running')
  const verify = vi.spyOn(engine.IncusDevelopmentVms.prototype, 'verify').mockImplementation(async (_id, _directory, expected) => {
    if (JSON.stringify(expected) !== JSON.stringify(mounts)) throw new Error('VM devices differ')
  })
  const stop = vi.spyOn(engine.IncusDevelopmentVms.prototype, 'stop').mockResolvedValue()
  const mount = async () => {
    const ctx = new Context(); contexts.push(ctx)
    await ctx.plugin(SharedVmRuntime, config); await ctx.executionRuntime.ensureReady()
    return ctx
  }
  return { config, source, root, mount, command, verify, stop, failReadiness: (count: number) => { failReadiness = count } }
}

// Incus Host directories and ownership checks use POSIX path and uid semantics.
describe.skipIf(process.platform === 'win32')('Workspace preparation over the shared runtime', () => {
  it.each([false, true])('loads the real Workspace and shared-VM providers from cordis.yml (catalogue=%s)', async (catalogue) => {
    const test = await fixture(catalogue)
    const filename = join(test.root, 'cordis.yml')
    await writeFile(filename, JSON.stringify([
      { id: 'runtime', name: 'cordis:selected-vm', config: test.config },
      { id: 'workspaces', name: 'cordis:selected-workspaces' },
    ]))
    const ctx = await boot('selected-workspace-test', filename, [], async (host) => {
      host.loader.builtins['selected-vm'] = SharedVmRuntime
      host.loader.builtins['selected-workspaces'] = WorkspaceRegistry
      await host.plugin(Storage)
      host.storage.backend.register('memory', new MemoryStorageBackend())
      const facility = new DomainFacility(host, { backend: 'memory', routes: {} })
      host.storage.mount('domain', facility)
      host.provide('storageDomain', facility)
      host.provide('sessionPersistence', { list: async () => [] } as never)
    })
    contexts.push(ctx)
    const workspace = await ctx.workspaceRegistry.create(test.source)
    const expected = catalogue ? /^\/workspace\/projects\/[a-f0-9]{64}$/ : /^\/workspace\/selected-/
    expect(ctx.executionRuntime.executionPath(workspace.path)).toMatch(expected)
    expect(test.command.mock.calls.filter(([args]) => args[0] === 'config')).toHaveLength(catalogue ? 0 : 1)
    if (!catalogue) await expect(ctx.workspaceRegistry.create(test.root)).rejects.toThrow('outside')
    expect(ctx.workspaceRegistry.list().map(value => value.path)).toEqual([test.source])
  })

  it('attaches a selected directory live, shares its path, and restores it on Harness restart', async () => {
    const test = await fixture(); const first = await test.mount()
    test.failReadiness(1)
    await Promise.all([prepareWorkspaceExecution(first, test.source), prepareWorkspaceExecution(first, test.source)])
    const path = first.executionRuntime.executionPath(test.source)
    expect(path).toMatch(/^\/workspace\/selected-[a-f0-9]{64}$/)
    expect(test.command.mock.calls.filter(([args]) => args[0] === 'config')).toHaveLength(1)
    expect(test.command.mock.calls.filter(([args]) => args.at(-1) === path).length).toBeGreaterThanOrEqual(2)
    await first.fiber.dispose()
    const second = await test.mount()
    expect(second.executionRuntime.executionPath(test.source)).toBe(path)
    expect(test.stop).not.toHaveBeenCalled()
    await expect(prepareWorkspaceExecution(second, test.root)).rejects.toThrow('outside')
  })

  it('waits for an admitted selection before releasing its manifest lease on disposal', async () => {
    const test = await fixture(); const ctx = await test.mount()
    const entered = Promise.withResolvers<undefined>(); const release = Promise.withResolvers<undefined>()
    // oxlint-disable-next-line typescript/unbound-method -- The interceptor restores the exact receiver with call().
    const original = SharedVmSelection.prototype.select
    vi.spyOn(SharedVmSelection.prototype, 'select').mockImplementation(async function(this: SharedVmSelection, source) {
      entered.resolve(undefined); await release.promise
      await original.call(this, source)
    })
    const selecting = prepareWorkspaceExecution(ctx, test.source)
    const rejected = expect(selecting).rejects.toThrow('closing')
    await entered.promise
    const disposed = ctx.fiber.dispose()
    release.resolve(undefined)
    await rejected; await disposed
    expect(test.command.mock.calls.filter(([args]) => args[0] === 'config')).toHaveLength(0)
    expect(test.stop).not.toHaveBeenCalled()
  })

  it('reports a selection that commits as shutdown begins while retaining its mount intent', async () => {
    const test = await fixture(); const ctx = await test.mount()
    // oxlint-disable-next-line typescript/unbound-method -- The interceptor restores the exact receiver with call().
    const original = SharedVmSelection.prototype.select
    const entered = Promise.withResolvers<undefined>(); const release = Promise.withResolvers<undefined>()
    vi.spyOn(SharedVmSelection.prototype, 'select').mockImplementation(async function(this: SharedVmSelection, source) {
      await original.call(this, source); entered.resolve(undefined); await release.promise
    })
    const selection = prepareWorkspaceExecution(ctx, test.source)
    const rejected = expect(selection).rejects.toThrow('closing')
    await entered.promise
    const disposed = ctx.fiber.dispose(); release.resolve(undefined)
    await rejected; await disposed
  })

  it('fails readiness at its configured deadline without publishing a host mapping', async () => {
    const test = await fixture(); const ctx = await test.mount()
    const time = vi.spyOn(Date, 'now')
    test.failReadiness(1)
    time.mockReturnValueOnce(0).mockReturnValue(10001)
    await expect(prepareWorkspaceExecution(ctx, test.source)).rejects.toThrow('not ready')
    expect(() => ctx.executionRuntime.executionPath(test.source)).toThrow('configured workspace')
  })

  it('ends readiness polling when disposal starts and retains the authorized pending intent', async () => {
    const test = await fixture(); const ctx = await test.mount()
    const entered = Promise.withResolvers<undefined>(); const release = Promise.withResolvers<undefined>()
    const original = test.command.getMockImplementation()!
    test.command.mockImplementation(async (args) => {
      if (args.at(-1)?.startsWith('/workspace/selected-')) {
        entered.resolve(undefined); await release.promise
        throw new Error('mount readiness interrupted')
      }
      return await original(args)
    })
    const operation = prepareWorkspaceExecution(ctx, test.source)
    const rejected = expect(operation).rejects.toThrow('mount readiness interrupted')
    await entered.promise
    const disposal = ctx.fiber.dispose(); release.resolve(undefined)
    await rejected; await disposal
    expect(test.stop).not.toHaveBeenCalled()
  })
})
