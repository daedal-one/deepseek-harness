import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import * as filesystem from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SharedVmSelection } from '../src/shared-vm-selection.ts'
import { sharedVmPaths } from '../src/shared-vm.ts'
import type { VmDirectoryMount } from '../src/vm-engine.ts'

vi.mock('node:fs/promises', async original => ({
  ...await original<typeof import('node:fs/promises')>(),
  statfs: vi.fn(async () => ({ type: 0xef53 })),
}))

const directories: string[] = []
const owners: SharedVmSelection[] = []
afterEach(async () => {
  await Promise.all(owners.splice(0).map(owner => owner.close()))
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  vi.restoreAllMocks()
})

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'dsh-selected-mount-')))
  directories.push(directory)
  const state = join(directory, 'state'); const root = join(directory, 'projects'); const workspace = join(directory, 'workspace')
  await Promise.all([mkdir(state, { mode: 0o700 }), mkdir(root), mkdir(workspace)])
  const existing = join(root, 'existing'); const source = join(root, 'selected')
  await Promise.all([mkdir(existing), mkdir(source)])
  const base = [{ source: existing, path: '/workspace/existing' }]
  let devices = [...base]
  const filename = join(state, 'workspace-mounts.json')
  const config = { roots: [root], directory: state, maxMounts: 4, maxStateBytes: 16384 }
  const operations = {
    validate: (repositories: VmDirectoryMount[]) => { sharedVmPaths({ workspaceDirectory: workspace, repositories }) },
    verify: vi.fn(async (expected: VmDirectoryMount[]) => {
      if (JSON.stringify(expected) !== JSON.stringify(devices)) throw new Error('unexpected VM devices')
    }),
    attach: vi.fn(async (mount: VmDirectoryMount, index: number) => {
      expect(index).toBe(devices.length)
      expect(JSON.parse(await readFile(filename, 'utf8'))).toMatchObject({ pending: mount.source })
      devices.push(mount)
    }),
    ready: vi.fn(async (_mount: VmDirectoryMount) => {}),
  }
  const owner = () => {
    const value = new SharedVmSelection(config, 'selected-test', base, operations, workspace)
    owners.push(value)
    return value
  }
  return { directory, state, root, workspace, source, base, config, operations, owner, filename,
    devices: () => devices, replaceDevices: (next: VmDirectoryMount[]) => { devices = next } }
}

// Incus Host directories and ownership checks use POSIX path and uid semantics.
describe.skipIf(process.platform === 'win32')('selected shared-VM mounts', () => {
  it('commits intent before attachment and publishes readiness before reuse across restart', async () => {
    const test = await fixture(); const first = test.owner()
    await first.open()
    await first.select(test.source)
    const mounts = first.mounts
    expect(mounts).toHaveLength(1)
    expect(mounts[0]!.source).toBe(test.source)
    expect(mounts[0]!.path).toMatch(/^\/workspace\/selected-[a-f0-9]{64}$/)
    expect(test.devices()).toEqual([...test.base, ...mounts])
    expect(JSON.parse(await readFile(test.filename, 'utf8'))).toEqual({ version: 1, environmentId: 'selected-test', sources: [test.source] })
    await first.select(test.source)
    expect(test.operations.attach).toHaveBeenCalledOnce()
    await first.close()
    const reopened = test.owner(); await reopened.open(); await reopened.recover()
    expect(reopened.mounts).toEqual(mounts)
    expect(test.operations.attach).toHaveBeenCalledOnce()
  })

  it('does not publish a host mapping while guest readiness is unresolved', async () => {
    const test = await fixture(); const owner = test.owner(); await owner.open()
    const entered = Promise.withResolvers<undefined>(); const ready = Promise.withResolvers<undefined>()
    test.operations.ready.mockImplementation(async () => { entered.resolve(undefined); await ready.promise })
    const selection = owner.select(test.source)
    try {
      await entered.promise
      expect(owner.mounts).toEqual([])
      expect(JSON.parse(await readFile(test.filename, 'utf8'))).toHaveProperty('pending', test.source)
    } finally { ready.resolve(undefined); await selection }
    expect(owner.mounts).toHaveLength(1)
  })

  it.each(['before-device', 'after-device'] as const)('recovers an interrupted intent %s without duplicating mounts', async (stage) => {
    const test = await fixture(); const first = test.owner(); await first.open()
    if (stage === 'before-device') test.operations.attach.mockRejectedValueOnce(new Error('Incus unavailable'))
    else test.operations.ready.mockRejectedValueOnce(new Error('mount not ready'))
    await expect(first.select(test.source)).rejects.toThrow()
    expect(first.mounts).toEqual([])
    await first.close()
    const reopened = test.owner(); await reopened.open(); await reopened.recover()
    expect(reopened.mounts).toHaveLength(1)
    expect(test.devices()).toHaveLength(2)
    expect(test.operations.attach).toHaveBeenCalledTimes(stage === 'before-device' ? 2 : 1)
  })

  it('refuses drift instead of replacing or removing unrelated VM devices', async () => {
    const test = await fixture(); const owner = test.owner(); await owner.open()
    test.replaceDevices([...test.base, { source: test.root, path: '/workspace/unrelated' }])
    await expect(owner.select(test.source)).rejects.toThrow('unexpected VM devices')
    expect(test.operations.attach).not.toHaveBeenCalled()
    expect(owner.mounts).toEqual([])
    expect(test.devices().at(-1)?.path).toBe('/workspace/unrelated')
  })

  it('refuses an unadmitted directory, the root itself, and overlapping mounts without writing intent', async () => {
    const test = await fixture(); const owner = test.owner(); await owner.open()
    await expect(owner.select(test.directory)).rejects.toThrow('outside')
    await expect(owner.select(test.root)).rejects.toThrow('outside')
    const parent = join(test.root, 'parent'); const child = join(parent, 'child')
    await mkdir(child, { recursive: true })
    await owner.select(child)
    await expect(owner.select(parent)).rejects.toThrow('overlapping')
    expect(test.operations.attach).toHaveBeenCalledOnce()
    expect(owner.mounts).toHaveLength(1)
  })

  it('holds one writer lease until disposal and leaves mounts available afterwards', async () => {
    const test = await fixture(); const first = test.owner(); await first.open()
    await expect(test.owner().open()).rejects.toThrow()
    await first.select(test.source); await first.close()
    const reopened = test.owner(); await reopened.open()
    expect(reopened.mounts).toHaveLength(1)
    expect(test.devices()).toHaveLength(2)
  })

  it.each([
    null,
    { version: 2, environmentId: 'selected-test', sources: [] },
    { version: 1, environmentId: 'other', sources: [] },
    { version: 1, environmentId: 'selected-test', sources: [1] },
    { version: 1, environmentId: 'selected-test', sources: [], pending: 1 },
  ])('rejects an invalid durable manifest: %j', async (record) => {
    const test = await fixture(); await writeFile(test.filename, JSON.stringify(record))
    await expect(test.owner().open()).rejects.toThrow('manifest')
    expect(test.operations.attach).not.toHaveBeenCalled()
  })

  it('rejects duplicate, over-capacity, and unadmitted durable sources', async () => {
    const test = await fixture()
    for (const record of [
      { sources: [test.source, test.source] },
      { sources: [test.source], pending: test.source },
      { sources: Array.from({ length: 5 }, (_, index) => `${test.root}/entry-${index}`) },
      { sources: [test.directory] },
    ]) {
      await writeFile(test.filename, JSON.stringify({ version: 1, environmentId: 'selected-test', ...record }))
      await expect(test.owner().open()).rejects.toThrow()
    }
    expect(test.operations.attach).not.toHaveBeenCalled()
  })

  it('enforces manifest and mount-count limits before adding a device', async () => {
    const test = await fixture(); test.config.maxStateBytes = 1
    const bounded = test.owner(); await bounded.open()
    await expect(bounded.select(test.source)).rejects.toThrow('bound')
    expect(test.operations.attach).not.toHaveBeenCalled()
    await bounded.close(); test.config.maxStateBytes = 16384; test.config.maxMounts = 1
    const limited = test.owner(); await limited.open(); await limited.select(test.source)
    const other = join(test.root, 'other'); await mkdir(other)
    await expect(limited.select(other)).rejects.toThrow('mount limit')
    expect(test.operations.attach).toHaveBeenCalledOnce()
  })

  it('rejects invalid authority, guest-visible storage, and RAM-backed directories', async () => {
    const test = await fixture(); test.config.roots = []
    await expect(test.owner().open()).rejects.toThrow('distinct roots')
    test.config.roots = [test.root]; test.config.directory = test.workspace
    await expect(test.owner().open()).rejects.toThrow('owner-only')
    test.config.directory = test.state
    vi.mocked(filesystem.statfs).mockResolvedValueOnce({ type: 0x01021994 } as Awaited<ReturnType<typeof filesystem.statfs>>)
    await expect(test.owner().open()).rejects.toThrow('disk-backed')
  })

  it('rejects state beneath admitted roots and noncanonical root configuration', async () => {
    const test = await fixture(); test.config.roots = [test.state]
    await expect(test.owner().open()).rejects.toThrow('overlaps an admitted root')
    test.config.roots = ['/']
    await expect(test.owner().open()).rejects.toThrow('canonical non-root')
  })
})
