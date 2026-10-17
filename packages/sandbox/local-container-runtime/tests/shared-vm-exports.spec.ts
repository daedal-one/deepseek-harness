import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import * as processes from 'node:child_process'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SharedVmExports, type SharedVmExportsConfig } from '../src/shared-vm-exports.ts'
import { sharedVmPaths } from '../src/shared-vm.ts'

vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof processes>() }))

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  try { for (const dispose of cleanup.splice(0).reverse()) await dispose() }
  finally { vi.restoreAllMocks() }
})

async function fixture(mode = '') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-exports-')))
  cleanup.push(async () => { await rm(root, { recursive: true, force: true }) })
  const directory = join(root, 'lease'); await mkdir(directory, { mode: 0o700 })
  const state = join(root, 'controller.json'); await writeFile(state, '[]')
  const native = [{ source: join(root, 'catalogue'), path: '/workspace/projects' }]
  const config: SharedVmExportsConfig = {
    command: process.execPath, args: [fileURLToPath(new URL('./fixtures/directory-exports.mjs', import.meta.url)), state, '/workspace/projects', mode],
    source: native[0]!.source, path: '/workspace/projects', directory, timeoutMs: 30000, maxOutputBytes: 8192,
  }
  const ready = vi.fn(async () => {})
  const bridge = () => {
    const exports = new SharedVmExports(config, 'test', native, join(root, 'workspace'), ready)
    cleanup.push(async () => { await exports.close() })
    return exports
  }
  return { root, state, native, config, ready, bridge }
}

// The production controller and exclusive writer lease require POSIX paths and uid semantics.
describe.skipIf(process.platform === 'win32')('shared VM export controller bridge', () => {
  it('restores more directories than spare PCI ports through bounded pages and one native mount', async () => {
    const f = await fixture(); const first = f.bridge(); await first.open()
    const sources = Array.from({ length: 12 }, (_, index) => join(f.root, `project-${index}`))
    for (const source of sources) await first.select(source)
    expect(f.native).toHaveLength(1)
    expect(first.mounts).toHaveLength(12)
    const map = sharedVmPaths({ workspaceDirectory: join(f.root, 'workspace'), repositories: f.native }, first.mounts)
    const path = map(sources[0]! + '/file.txt')
    expect(path).toMatch(/^\/workspace\/projects\/[a-f0-9]{64}\/file.txt$/)
    await expect(first.select(sources[0]!)).resolves.toBeUndefined()
    expect(JSON.parse(await readFile(f.state, 'utf8'))).toHaveLength(12)
    await first.close()
    const second = f.bridge(); await second.open(); await second.restore(); await second.verify()
    await second.ensureCurrent()
    expect(second.mounts).toHaveLength(12)
    const restored = sharedVmPaths({ workspaceDirectory: join(f.root, 'workspace'), repositories: f.native }, second.mounts)
    expect(restored(sources[0]! + '/file.txt')).toBe(path)
    expect(() => restored(join(f.root, 'unselected'))).toThrow('configured workspace')
  })

  it('holds an exclusive Harness lease and releases it on close', async () => {
    const f = await fixture(); const first = f.bridge(); await first.open()
    await expect(f.bridge().open()).rejects.toThrow()
    await first.close()
    const recovered = f.bridge(); await expect(recovered.open()).resolves.toBeUndefined()
  })

  it('publishes a new mapping only after guest readiness and recovers a retained failed selection', async () => {
    const f = await fixture(); const exports = f.bridge(); await exports.open()
    const source = join(f.root, 'project')
    f.ready.mockRejectedValueOnce(new Error('guest not ready'))
    await expect(exports.select(source)).rejects.toThrow('guest not ready')
    expect(exports.mounts).toEqual([])
    expect(JSON.parse(await readFile(f.state, 'utf8'))).toEqual([source])
    await exports.select(source)
    expect(exports.mounts).toHaveLength(1)
    await expect(exports.select(f.root)).rejects.toThrow('invalid directory export')
    await expect(exports.select(source + '/nested')).rejects.toThrow('invalid directory export')
  })

  it.each(['bad-cursor', 'overflow', 'combined-overflow'])('rejects %s and releases the writer lease', async (mode) => {
    const f = await fixture(mode); const invalid = f.bridge(); await invalid.open()
    await expect(invalid.restore()).rejects.toThrow()
    await invalid.close()
    f.config.args.pop(); f.config.args.push('')
    await expect(f.bridge().open()).resolves.toBeUndefined()
  })

  it.each(['bad JSON', 'array response', 'failure response', 'null page', 'invalid mounts', 'invalid cursor',
    'cursor mismatch', 'duplicate mount', 'invalid source', 'invalid target'] as const)('rejects malformed controller wire data: %s', async (kind) => {
    const f = await fixture('response'); const exports = f.bridge(); await exports.open()
    const source = join(f.root, 'project'); const id = createHash('sha256').update(source).digest('hex')
    const mount = { source, path: '/workspace/projects/' + id }
    const response = {
      'bad JSON': 'not JSON', 'array response': [], 'failure response': { ok: false },
      'null page': { ok: true, value: null },
      'invalid mounts': { ok: true, value: { mounts: false, next: null } },
      'invalid cursor': { ok: true, value: { mounts: [], next: 'unknown' } },
      'cursor mismatch': { ok: true, value: { mounts: [mount], next: id === 'f'.repeat(64) ? 'e'.repeat(64) : 'f'.repeat(64) } },
      'duplicate mount': { ok: true, value: { mounts: [mount, mount], next: null } },
      'invalid source': { ok: true, value: { mounts: [{ ...mount, source: '/path/../outside' }], next: null } },
      'invalid target': { ok: true, value: { mounts: [{ ...mount, path: '/workspace/other' }], next: null } },
    }[kind]
    await writeFile(f.state + '.response', typeof response === 'string' ? response : JSON.stringify(response))
    await expect(exports.restore()).rejects.toThrow('invalid directory export')
    await exports.close()
    await expect(f.bridge().open()).resolves.toBeUndefined()
  })

  it('rejects a controller selection response belonging to a different source', async () => {
    const f = await fixture('response'); const exports = f.bridge(); await exports.open()
    const source = join(f.root, 'different')
    const path = '/workspace/projects/' + createHash('sha256').update(source).digest('hex')
    await writeFile(f.state + '.response', JSON.stringify({ ok: true, value: { source, path } }))
    await expect(exports.select(join(f.root, 'requested'))).rejects.toThrow('invalid directory export')
    expect(exports.mounts).toEqual([])
  })

  it('requires the exact catalogue and private service-owned lease storage', async () => {
    const f = await fixture(); f.config.path = '/workspace/other'
    await expect(f.bridge().open()).rejects.toThrow('exact catalogue')
    f.config.path = '/workspace/projects'; f.config.directory = f.root
    await expect(f.bridge().open()).rejects.toThrow('private')
  })

  it('coalesces worker restart recovery and joins it before releasing the Harness lease', async () => {
    const f = await fixture(); const exports = f.bridge(); await exports.open(); await exports.restore()
    await exports.select(join(f.root, 'first'))
    const sources = [join(f.root, 'first'), join(f.root, 'second')]
    await writeFile(f.state, JSON.stringify(sources)); await writeFile(f.state + '.generation', '2'.repeat(64))
    const entered = Promise.withResolvers<undefined>(); const release = Promise.withResolvers<undefined>()
    const restore = exports.restore.bind(exports)
    const observed = vi.spyOn(exports, 'restore').mockImplementation(async () => {
      entered.resolve(undefined); await release.promise; await restore()
    })
    const first = exports.ensureCurrent(); const second = exports.ensureCurrent()
    await entered.promise
    expect(exports.mounts).toHaveLength(1)
    let closed = false
    const closing = exports.close().then(() => { closed = true })
    try {
      await expect(f.bridge().open()).rejects.toThrow()
      expect(closed).toBe(false)
    } finally { release.resolve(undefined); await Promise.all([first, second, closing]) }
    expect(observed).toHaveBeenCalledOnce()
    expect(exports.mounts.map(value => value.source).sort()).toEqual(sources.sort())
    await expect(f.bridge().open()).resolves.toBeUndefined()
  })

  it('rejects an invalid namespace generation without losing the existing aliases or lease', async () => {
    const f = await fixture(); const exports = f.bridge(); await exports.open(); await exports.restore()
    await exports.select(join(f.root, 'first'))
    await writeFile(f.state + '.generation', 'invalid')
    await expect(exports.ensureCurrent()).rejects.toThrow('invalid directory export')
    expect(exports.mounts).toHaveLength(1)
    await expect(f.bridge().open()).rejects.toThrow()
    await exports.close()
  })

  it('refuses a generation change during restoration and joins failed recovery before releasing its lease', async () => {
    const unstable = await fixture('generation-change'); const changing = unstable.bridge(); await changing.open()
    await expect(changing.restore()).rejects.toThrow('namespace changed during restoration')
    expect(changing.mounts).toEqual([])
    const f = await fixture(); const exports = f.bridge(); await exports.open(); await exports.restore()
    await exports.select(join(f.root, 'retained'))
    await writeFile(f.state + '.generation', '2'.repeat(64))
    f.ready.mockRejectedValueOnce(new Error('guest visibility failed'))
    const check = exports.ensureCurrent(); const closing = exports.close()
    await expect(check).rejects.toThrow('guest visibility failed'); await closing
    await expect(f.bridge().open()).resolves.toBeUndefined()
  })

  it.each(['EPIPE', 'EIO'])('settles a controller stdin %s only after its process completion callback', async (code) => {
    const f = await fixture(); const exports = f.bridge(); await exports.open()
    const source = join(f.root, 'project')
    const child = new processes.ChildProcess(); child.stdin = new PassThrough()
    const kill = vi.spyOn(child, 'kill').mockReturnValue(true)
    let finish: (() => void) | undefined
    vi.spyOn(processes, 'execFile').mockImplementation((...arguments_) => {
      const callback = arguments_.at(-1) as (error: null, stdout: string, stderr: string) => void
      finish = () => { callback(null, JSON.stringify({ ok: true, value: {
        source, path: '/workspace/projects/' + createHash('sha256').update(source).digest('hex'),
      } }), '') }
      return child
    })
    vi.spyOn(child.stdin, 'end').mockImplementation(() => {
      child.stdin!.emit('error', Object.assign(new Error('stdin failed'), { code })); return child.stdin!
    })
    let settled = false
    const selected = exports.select(source).finally(() => { settled = true })
    const checked = code === 'EPIPE' ? expect(selected).resolves.toBeUndefined() : expect(selected).rejects.toThrow('controller failed')
    await Promise.resolve(); expect(settled).toBe(false)
    expect(kill).toHaveBeenCalledTimes(code === 'EPIPE' ? 0 : 1)
    finish!(); await checked
    child.stdin.destroy()
  })
})
