/** Durable, exact-directory attachment for operator-admitted Workspace selections. @module */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath, statfs, type FileHandle } from 'node:fs/promises'
import { posix } from 'node:path'
import { tryLockExclusive } from '@deepseek-ai/node-addon-system/flock'
import { publishWorkspaceJson, readWorkspaceJson } from './workspace-git.ts'
import type { VmDirectoryMount } from './vm-engine.ts'

/** Operator authority and storage bounds for directories selected through Workspace commands. */
export interface WorkspaceSelectionConfig {
  /** Canonical parent directories whose strict descendants may be selected. */
  roots: string[]
  /** Existing canonical owner-only directory outside every guest mount and selection root. */
  directory: string
  /** Maximum retained selected mounts, excluding operator-configured repositories. */
  maxMounts: number
  /** Complete serialized manifest byte bound. */
  maxStateBytes: number
}

interface SelectionRecord {
  version: 1
  environmentId: string
  sources: string[]
  pending?: string
}

interface MountOperations {
  validate(mounts: VmDirectoryMount[]): void
  verify(mounts: VmDirectoryMount[]): Promise<void>
  attach(mount: VmDirectoryMount, index: number): Promise<void>
  ready(mount: VmDirectoryMount): Promise<void>
}

/** Serial attachment owner; the lifetime lease excludes another writer after process restart. */
export class SharedVmSelection {
  private lease: FileHandle | undefined
  private record: SelectionRecord
  private readonly filename: string

  /**
   * @param config - operator-approved roots and private storage bounds.
   * @param environmentId - retained VM environment identity.
   * @param base - immutable operator-configured repository mounts.
   * @param operations - exact VM verification, attachment, and readiness operations.
   * @param workspaceDirectory - Host directory already exposed as the guest workspace root.
   */
  constructor(
    private readonly config: WorkspaceSelectionConfig,
    private readonly environmentId: string,
    private readonly base: readonly VmDirectoryMount[],
    private readonly operations: MountOperations,
    private readonly workspaceDirectory: string,
  ) {
    this.filename = posix.join(config.directory, 'workspace-mounts.json')
    this.record = { version: 1, environmentId, sources: [] }
  }

  /** Committed selected mounts in their durable device order. */
  get mounts(): VmDirectoryMount[] { return this.record.sources.map(mountFor) }

  /**
   * Acquire the environment lease and restore validated mount intent without changing the VM.
   * @returns resolution after private storage and every recorded source are validated.
   */
  async open(): Promise<void> {
    if (!Number.isSafeInteger(this.config.maxMounts) || this.config.maxMounts < 1
      || !Number.isSafeInteger(this.config.maxStateBytes) || this.config.maxStateBytes < 1
      || this.config.roots.length === 0 || new Set(this.config.roots).size !== this.config.roots.length) {
      throw new Error('shared-vm: workspace selection requires distinct roots and positive storage bounds')
    }
    const directory = this.config.directory
    await validateDirectory(directory)
    const info = await lstat(directory)
    if ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()
      || overlaps(directory, this.workspaceDirectory) || this.base.some(mount => overlaps(directory, mount.source))) {
      throw new Error('shared-vm: workspace selection storage must be owner-only and outside guest mounts')
    }
    for (const root of this.config.roots) {
      await validateDirectory(root)
      if (overlaps(directory, root)) throw new Error('shared-vm: workspace selection storage overlaps an admitted root')
    }
    this.lease = await open(posix.join(directory, 'workspace-mounts.lock'), constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600)
    try {
      await tryLockExclusive(this.lease.fd)
      try {
        this.record = parseRecord(
          await readWorkspaceJson(this.filename, this.config.maxStateBytes), this.environmentId, this.config.maxMounts,
        )
      }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const sources = [...this.record.sources, ...this.record.pending === undefined ? [] : [this.record.pending]]
      for (const source of sources) {
        await this.validateSource(source)
      }
      this.operations.validate([...this.base, ...this.mounts, ...this.pendingMounts()])
    } catch (error) {
      await this.close()
      throw error
    }
  }

  /**
   * Finish a durable attachment intent against either the exact prior or exact prospective VM devices.
   * @returns resolution after the selected mount is usable and its ready record is durable.
   */
  async recover(): Promise<void> {
    const source = this.record.pending
    if (source === undefined) return
    const current = [...this.base, ...this.mounts]
    const mount = mountFor(source)
    try { await this.operations.verify([...current, mount]) }
    catch {
      // Only the exact pre-attachment VM permits adding the recorded device.
      await this.operations.verify(current)
      await this.operations.attach(mount, current.length)
      await this.operations.verify([...current, mount])
    }
    await this.operations.ready(mount)
    await this.publish({ version: 1, environmentId: this.environmentId, sources: [...this.record.sources, source] })
  }

  /**
   * Attach one explicitly selected directory without widening roots or Git authorization.
   * @param source - canonical selected Host directory.
   * @returns resolution after durable intent, verified attachment, and durable readiness.
   */
  async select(source: string): Promise<void> {
    await this.recover()
    if (this.record.sources.includes(source)) return
    await this.validateSource(source)
    if (this.record.sources.length >= this.config.maxMounts) throw new Error('shared-vm: selected workspace mount limit reached; ask the operator to review retained mounts')
    this.operations.validate([...this.base, ...this.mounts, mountFor(source)])
    const pending = { ...this.record, pending: source }
    await this.publish(pending)
    await this.recover()
  }

  /** Release only the manifest lease; mounts, files, and the retained VM remain available. */
  async close(): Promise<void> {
    await this.lease?.close()
    this.lease = undefined
  }

  private pendingMounts(): VmDirectoryMount[] {
    return this.record.pending === undefined ? [] : [mountFor(this.record.pending)]
  }

  private async validateSource(source: string): Promise<void> {
    await validateDirectory(source)
    if (!this.config.roots.some(root => inside(root, source))) {
      throw new Error(`shared-vm: '${source}' is outside the configured workspace selection roots; ask the operator to admit its parent`)
    }
  }

  private async publish(record: SelectionRecord): Promise<void> {
    await publishWorkspaceJson(this.filename, record, this.config.maxStateBytes)
    this.record = record
  }
}

function mountFor(source: string): VmDirectoryMount {
  return { source, path: `/workspace/selected-${createHash('sha256').update(source).digest('hex')}` }
}

function inside(parent: string, child: string): boolean { return child.startsWith(`${parent}/`) }
function overlaps(left: string, right: string): boolean { return left === right || inside(left, right) || inside(right, left) }

async function validateDirectory(path: string): Promise<void> {
  if (!posix.isAbsolute(path) || path === '/' || path.includes('\0') || path.endsWith('/') || posix.normalize(path) !== path) {
    throw new Error('shared-vm: workspace selections require canonical non-root directories')
  }
  const [info, canonical, filesystem] = await Promise.all([lstat(path), realpath(path), statfs(path)])
  if (!info.isDirectory() || canonical !== path || filesystem.type === 0x01021994) {
    throw new Error('shared-vm: workspace selections require real disk-backed directories')
  }
}

function parseRecord(value: unknown, environmentId: string, maxMounts: number): SelectionRecord {
  if (typeof value !== 'object' || value === null) throw new Error('shared-vm: invalid workspace mount manifest')
  const record = value as Record<string, unknown>
  if (record.version !== 1 || record.environmentId !== environmentId || !Array.isArray(record.sources)
    || record.sources.some(source => typeof source !== 'string')
    || new Set(record.sources).size !== record.sources.length
    || (record.pending !== undefined && (typeof record.pending !== 'string' || record.sources.includes(record.pending)))
    || record.sources.length + (record.pending === undefined ? 0 : 1) > maxMounts) {
    throw new Error('shared-vm: invalid workspace mount manifest')
  }
  return { version: 1, environmentId, sources: record.sources as string[],
    ...record.pending === undefined ? {} : { pending: record.pending } }
}
