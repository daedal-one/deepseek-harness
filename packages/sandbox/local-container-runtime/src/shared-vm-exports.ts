/** Exact selected directories attached inside one virtiofsd sandbox namespace. @module */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises'
import { posix } from 'node:path'
import { tryLockExclusive } from '@deepseek-ai/node-addon-system/flock'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { VmDirectoryMount } from './vm-engine.ts'

type ExportGeneration = Branded<'SharedVmExportGeneration'>

/** Root-owned export controller and one pre-provisioned catalogue device. */
export interface SharedVmExportsConfig {
  /** Absolute operator-installed controller launcher; never selected by a guest. */
  command: string
  /** Fixed launcher arguments, including a configured sudo wrapper when required. */
  args: string[]
  /** Existing root-owned Host catalogue source, also declared as one repository device. */
  source: string
  /** Guest catalogue root matching that repository device. */
  path: string
  /** Existing service-owned private lease directory outside all guest mounts. */
  directory: string
  /** Bound on each controller request. */
  timeoutMs: number
  /** Combined stdout/stderr bound for one paginated response. */
  maxOutputBytes: number
}

/** Holds the Harness lease while the root controller owns retained export records and mounts. */
export class SharedVmExports {
  private lease: FileHandle | undefined
  private readonly selected = new Map<string, VmDirectoryMount>()
  private generation: ExportGeneration | undefined
  private checking: Promise<void> | undefined

  /**
   * @param config - fixed controller and catalogue definition.
   * @param environmentId - exact retained environment identity.
   * @param native - complete operator-provisioned repository devices.
   * @param workspaceDirectory - existing guest workspace root source.
   * @param ready - guest observation that the selected directory can be opened.
   */
  constructor(
    private readonly config: SharedVmExportsConfig,
    private readonly environmentId: string,
    private readonly native: readonly VmDirectoryMount[],
    private readonly workspaceDirectory: string,
    private readonly ready: (mount: VmDirectoryMount) => Promise<void>,
  ) {}

  /** Selected path aliases; they do not each create a VM device. */
  get mounts(): VmDirectoryMount[] { return [...this.selected.values()] }

  /** Acquire the Harness writer lease before VM startup or export restoration. */
  async open(): Promise<void> {
    const portal = this.native.find(mount => mount.source === this.config.source && mount.path === this.config.path)
    if (portal === undefined
      || !posix.isAbsolute(this.config.command) || this.config.command.includes('\0')
      || this.config.args.some(value => value.includes('\0'))
      || !Number.isSafeInteger(this.config.timeoutMs) || this.config.timeoutMs < 1 || this.config.timeoutMs > 2_147_483_647
      || !Number.isSafeInteger(this.config.maxOutputBytes) || this.config.maxOutputBytes < 1) {
      throw new Error('shared-vm: directory exports require an exact catalogue device and bounded fixed controller')
    }
    const directory = this.config.directory
    const info = await lstat(directory)
    const sources = [this.workspaceDirectory, ...this.native.map(mount => mount.source)]
    if (!info.isDirectory() || await realpath(directory) !== directory || info.uid !== process.getuid?.()
      || (info.mode & 0o077) !== 0 || sources.some(source => directory === source
        || directory.startsWith(`${source}/`) || source.startsWith(`${directory}/`))) {
      throw new Error('shared-vm: export lease storage must be service-owned, private, and outside guest mounts')
    }
    this.lease = await open(posix.join(directory, 'directory-exports.lock'), constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600)
    try {
      await tryLockExclusive(this.lease.fd)
    } catch (error) { await this.close(); throw error }
  }

  /** Restore retained aliases in the live virtiofsd namespace before guest toolchain readiness. */
  async restore(): Promise<void> {
    const restored = new Map<string, VmDirectoryMount>()
    let after = ''
    const generation = await this.currentGeneration()
    do {
      const value = record(await this.call({ operation: 'list', after }))
      if (!Array.isArray(value.mounts) || (value.next !== null && (typeof value.next !== 'string'
        || !/^[a-f0-9]{64}$/u.test(value.next) || value.next <= after))) throw protocolFailure()
      let last = after
      for (const entry of value.mounts) {
        const mount = this.parseMount(entry)
        const cursor = createHash('sha256').update(mount.source).digest('hex')
        if (cursor <= last) throw protocolFailure()
        this.remember(mount, restored)
        last = cursor
      }
      if (value.next !== null && (value.mounts.length === 0 || value.next !== last)) throw protocolFailure()
      after = value.next ?? ''
    } while (after !== '')
    if (await this.currentGeneration() !== generation) throw new Error('shared-vm: export namespace changed during restoration')
    this.selected.clear()
    for (const [source, mount] of restored) this.selected.set(source, mount)
    this.generation = generation
  }

  /** Join a coalesced worker-generation check and restore exports after an independent VM restart. */
  async ensureCurrent(): Promise<void> {
    if (this.checking !== undefined) { await this.checking; return }
    const operation = (async () => {
      if (await this.currentGeneration() === this.generation) return
      await this.restore()
      await this.verify()
    })()
    this.checking = operation
    try { await operation }
    finally { this.checking = undefined }
  }

  /**
   * Attach an exact authorized directory through the operator controller and await guest readiness.
   * @param source - canonical directory selected by a Host Workspace operation.
   */
  async select(source: string): Promise<void> {
    const existing = this.selected.get(source)
    if (existing !== undefined) { await this.ready(existing); return }
    this.validateSource(source)
    const mount = this.parseMount(await this.call({ operation: 'select', source }))
    if (mount.source !== source) throw protocolFailure()
    await this.ready(mount)
    this.remember(mount)
  }

  /** Recheck guest visibility of restored retained directories after VM readiness. */
  async verify(): Promise<void> { for (const mount of this.selected.values()) await this.ready(mount) }

  /** Release only this Harness's lease; root-owned records and exports remain available. */
  async close(): Promise<void> {
    // The readiness caller owns a failed check; close still joins it before releasing the lease.
    await this.checking?.catch(() => undefined)
    await this.releaseLease()
  }

  private async releaseLease(): Promise<void> { await this.lease?.close(); this.lease = undefined }

  private async currentGeneration(): Promise<ExportGeneration> {
    const value = await this.call({ operation: 'generation' })
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw protocolFailure()
    return brandString<ExportGeneration>(value)
  }

  private remember(mount: VmDirectoryMount, selected = this.selected): void {
    this.validateSource(mount.source, selected)
    selected.set(mount.source, mount)
  }

  private validateSource(source: string, selected = this.selected): void {
    for (const other of [this.workspaceDirectory, ...this.native.map(mount => mount.source), ...selected.keys()]) {
      if (source === other || source.startsWith(`${other}/`) || other.startsWith(`${source}/`)) throw protocolFailure()
    }
  }

  private parseMount(value: unknown): VmDirectoryMount {
    const mount = record(value)
    if (typeof mount.source !== 'string' || !posix.isAbsolute(mount.source) || mount.source === '/'
      || posix.normalize(mount.source) !== mount.source || mount.source.includes('\0') || mount.source.endsWith('/')
      || mount.path !== `${this.config.path}/${createHash('sha256').update(mount.source).digest('hex')}`) throw protocolFailure()
    return { source: mount.source, path: mount.path }
  }

  private async call(request: Record<string, string>): Promise<unknown> {
    const input = JSON.stringify({ ...request, environmentId: this.environmentId })
    return await new Promise((resolve, reject) => {
      let inputError: Error | undefined
      const child = execFile(this.config.command, this.config.args, {
        timeout: this.config.timeoutMs, maxBuffer: this.config.maxOutputBytes, encoding: 'utf8',
        env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
      }, (error, stdout, stderr) => {
        const tooLarge = Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > this.config.maxOutputBytes
        if (error !== null || inputError !== undefined || tooLarge) {
          reject(new Error('shared-vm: directory export controller failed; reconcile retained export state', { cause: inputError ?? error }))
          return
        }
        try {
          const response = record(JSON.parse(stdout))
          if (response.ok !== true) throw protocolFailure()
          resolve(response.value)
        } catch (failure) { reject(new Error('shared-vm: invalid directory export response', { cause: failure })) }
      })
      child.stdin?.on('error', (error) => {
        if ((error as NodeJS.ErrnoException).code === 'EPIPE') return
        inputError = error
        child.kill('SIGKILL')
      })
      child.stdin?.end(input)
    })
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw protocolFailure()
  return value as Record<string, unknown>
}
function protocolFailure(): Error { return new Error('shared-vm: invalid directory export response') }
