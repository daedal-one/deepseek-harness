/**
 * Container-namespace implementation of `ctx.fs`. The runtime owner executes one
 * bounded controller process per filesystem operation, so Node never accesses the
 * runtime backing directory.
 * @module @deepseek-ai/dsh-fs-local-container
 */

import type {} from '@deepseek-ai/dsh-local-container-runtime/workspaces'
import { posix } from 'node:path'
import { Buffer, constants as bufferConstants } from 'node:buffer'
import { Context } from '@deepseek-ai/cordis'
import { FileSystem, FsError, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type {
  FsDirEntry,
  FsEditOutcome,
  FsEditRequest,
  FsErrorCode,
  FsInfo,
  FsPathInfo,
  FsTarget,
  FsWriteIntent,
  FsWriteOutcome,
} from '@deepseek-ai/dsh-fs'
import {
  LocalContainerControllerAborted,
  LocalContainerControllerDeadlineExceeded,
  WORKSPACE_PATH,
} from '@deepseek-ai/dsh-local-container-runtime'
import z from '@deepseek-ai/schemastery'
import { FILESYSTEM_CONTROLLER } from './controller.ts'

const RESPONSE_OVERHEAD_BYTES = 1024
const MAX_FILE_BYTES = Math.floor((Math.min(bufferConstants.MAX_LENGTH, bufferConstants.MAX_STRING_LENGTH) - RESPONSE_OVERHEAD_BYTES) / 3)
const ERROR_CODES = new Set<FsErrorCode>([
  'FS_NOT_FOUND',
  'FS_NOT_DIRECTORY',
  'FS_NOT_TEXT',
  'FS_NOT_REGULAR_FILE',
  'FS_TOO_LARGE',
  'FS_PERMISSION_DENIED',
  'FS_SANDBOX_DENIED',
  'FS_IO_ERROR',
  'FS_STALE_VERSION',
  'FS_NOT_OBSERVED',
  'FS_AMBIGUOUS_EDIT',
  'FS_EDIT_NOT_FOUND',
  'FS_ABORTED',
])

/** Deployment-specific bounds and host Session cwd aliases for this provider. */
export interface Config {
  /** Exact host Session cwd values that represent the container workspace. */
  cwdAliases: string[]
  /** Maximum UTF-8 bytes in a file read, written, or edited through this provider. */
  maxFileBytes: number
  /** Exclusive UTF-8 byte limit on each overwrite diff basis side. */
  diffBasisMaxBytes: number
  /** Complete stdout and stderr byte bound on each controller execution. */
  maxControllerOutputBytes: number
  /** Per-filesystem-operation deadline enforced by the runtime owner. */
  operationTimeoutMs: number
}

type ResolvedConfig = Readonly<Config>

interface ControllerRequest {
  readonly operation: string
  readonly [key: string]: unknown
}

/** Container-backed filesystem provider sharing the local runtime owner's execution world. */
export class LocalContainerFileSystem extends FileSystem {
  static inject = ['localContainerRuntime']
  static Config: z<Config> = z.object({
    cwdAliases: z.array(z.string()).required(),
    maxFileBytes: z.natural().required(),
    diffBasisMaxBytes: z.natural().required(),
    maxControllerOutputBytes: z.natural().required(),
    operationTimeoutMs: z.natural().required(),
  })

  /** Validated immutable deployment configuration. */
  readonly config: ResolvedConfig
  private readonly locks = new Map<string, Promise<unknown>>()
  private readonly lifetime = new AbortController()
  private readonly inFlight = new Set<Promise<unknown>>()
  private disposing = false

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.config = this.resolveConfig(config)
    ctx.effect(() => async () => {
      this.disposing = true
      this.lifetime.abort()
      await Promise.allSettled(this.inFlight)
      this.locks.clear()
    }, 'local container filesystem teardown')
  }

  /** This provider shares the runtime owner's container path and process world. */
  override get executionWorld(): object {
    return this.ctx.get('conversationWorkspaces')?.executionWorld ?? this.ctx.localContainerRuntime.executionWorld
  }

  override async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    path = this.executionPath(path, opts?.cwd)
    return this.target(await this.execute({ operation: 'resolve', path }, opts?.signal, 'resolve'))
  }

  override processPath(target: FsTarget): string {
    return this.targetRequest(target).targetKey
  }

  override fileUrl(target: FsTarget): string {
    const path = this.processPath(target)
    if (!isWorkspacePath(path)) throw new Error('fs-local-container: target process path is outside /workspace')
    return `file://${path.split('/').map(segment => encodeURIComponent(segment)).join('/')}`
  }

  override contains(parent: FsTarget, child: FsTarget): boolean {
    const parentPath = String(parent.targetKey)
    const childPath = String(child.targetKey)
    return childPath === parentPath || childPath.startsWith(`${parentPath}/`)
  }

  override async stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined> {
    const value = await this.execute({ operation: 'stat', ...this.targetRequest(target) }, signal, 'stat')
    if (value === null) return undefined
    return this.info(value)
  }

  override async lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined> {
    path = this.executionPath(path, opts?.cwd)
    const value = await this.execute({ operation: 'lstat', path }, signal, 'lstat')
    if (value === null) return undefined
    return this.pathInfo(value)
  }

  override async readText(target: FsTarget, signal?: AbortSignal): Promise<string> {
    const value = await this.execute({ operation: 'readText', ...this.targetRequest(target), maxFileBytes: this.config.maxFileBytes }, signal, 'read')
    return this.text(this.data(value))
  }

  override async streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>> {
    const text = await this.readText(target, signal)
    return {
      async *[Symbol.asyncIterator](): AsyncGenerator<string> {
        if (text.length > 0) yield Promise.resolve(text)
      },
    }
  }

  override async readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    this.byteLimit(maxBytes)
    const value = await this.execute({ operation: 'readBytes', ...this.targetRequest(target), maxBytes }, signal, 'read')
    return this.data(value)
  }

  override async readByteRange(target: FsTarget, range: { offset: number; length: number }, signal?: AbortSignal): Promise<Uint8Array> {
    this.byteLimit(range.offset)
    this.byteLimit(range.length)
    const value = await this.execute({
      operation: 'readByteRange',
      ...this.targetRequest(target),
      offset: range.offset,
      length: range.length,
      maxFileBytes: this.config.maxFileBytes,
    }, signal, 'read')
    return this.data(value)
  }

  override async listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]> {
    const value = await this.execute({ operation: 'listDir', ...this.targetRequest(target) }, signal, 'list')
    if (!Array.isArray(value)) throw this.protocolFailure()
    return value.map(entry => this.dirEntry(entry))
  }

  override async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
  ): Promise<FsWriteOutcome> {
    this.contentLimit(content)
    return await this.withLock(String(target.targetKey), async () => {
      const value = await this.execute({
        operation: 'writeText',
        ...this.targetRequest(target),
        content: Buffer.from(content, 'utf8').toString('base64'),
        ...expected === undefined ? {} : { expected },
        maxFileBytes: this.config.maxFileBytes,
        diffBasisMaxBytes: this.config.diffBasisMaxBytes,
      }, signal, 'write')
      const result = this.record(value)
      const before = result.before === null ? null : this.text(this.decode(result.before))
      return {
        operation: result.operation,
        version: FsVersion(result.version),
        before,
        after: normalizeLineEndings(content),
      }
    })
  }

  override async editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: FsVersion },
    signal?: AbortSignal,
  ): Promise<FsEditOutcome> {
    this.contentLimit(edit.oldString)
    this.contentLimit(edit.newString)
    return await this.withLock(String(target.targetKey), async () => {
      const value = await this.execute({
        operation: 'editText',
        ...this.targetRequest(target),
        edit,
        ...expected === undefined ? {} : { expected },
        maxFileBytes: this.config.maxFileBytes,
      }, signal, 'edit')
      const result = this.editRecord(value)
      return {
        version: FsVersion(result.version),
        before: this.text(this.decode(result.before)),
        after: this.text(this.decode(result.after)),
      }
    })
  }

  private async withLock<T>(targetKey: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(targetKey) ?? Promise.resolve()
    const run = prior.then(operation, operation)
    const tail = run.then(() => undefined, () => undefined)
    this.locks.set(targetKey, tail)
    try {
      return await run
    } finally {
      if (this.locks.get(targetKey) === tail) this.locks.delete(targetKey)
    }
  }

  private async execute(request: ControllerRequest, signal: AbortSignal | undefined, operation: string): Promise<unknown> {
    if (this.disposing || signal?.aborted === true || this.lifetime.signal.aborted) {
      throw new FsError(`${operation} aborted`, 'FS_ABORTED')
    }
    const combined = signal === undefined ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal])
    const controllerRequest = (this.ctx.get('conversationWorkspaces')?.capture() ?? this.ctx.localContainerRuntime).executeController({
      argv: ['/usr/bin/python3', '-c', FILESYSTEM_CONTROLLER],
      stdin: Buffer.from(JSON.stringify(request), 'utf8'),
      maxOutputBytes: this.config.maxControllerOutputBytes,
      deadlineMs: this.config.operationTimeoutMs,
      signal: combined,
    })
    const tracked = controllerRequest.then(
      result => this.controllerValue(result.exitCode, result.stdout, operation),
      (error: unknown) => { throw this.controllerFailure(operation, error) },
    )
    this.inFlight.add(tracked)
    try {
      return await tracked
    } finally {
      this.inFlight.delete(tracked)
    }
  }

  private controllerValue(exitCode: number, stdout: Uint8Array, operation: string): unknown {
    if (exitCode !== 0) throw this.protocolFailure()
    let parsed: unknown
    try {
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stdout))
    } catch {
      throw this.protocolFailure()
    }
    if (!isRecord(parsed) || typeof parsed.ok !== 'boolean') throw this.protocolFailure()
    if (parsed.ok) return parsed.value
    if (typeof parsed.code !== 'string' || !ERROR_CODES.has(parsed.code as FsErrorCode)) throw this.protocolFailure()
    throw new FsError(`cannot ${operation}: container filesystem reported ${parsed.code}`, parsed.code as FsErrorCode)
  }

  private controllerFailure(operation: string, error: unknown): FsError {
    if (error instanceof FsError) return error
    if (error instanceof LocalContainerControllerAborted || this.lifetime.signal.aborted) {
      return new FsError(`${operation} aborted`, 'FS_ABORTED', { cause: error })
    }
    if (error instanceof LocalContainerControllerDeadlineExceeded) {
      return new FsError(`cannot ${operation}: container controller deadline exceeded`, 'FS_IO_ERROR', { cause: error })
    }
    return new FsError(`cannot ${operation}: container controller failed`, 'FS_IO_ERROR', { cause: error })
  }

  private targetRequest(target: FsTarget): { targetKey: string; path: string } {
    let key = String(target.targetKey)
    const workspaces = this.ctx.get('conversationWorkspaces')
    if (workspaces !== undefined) {
      const prefix = `${workspaces.targetNamespace}:`
      if (!key.startsWith(prefix)) throw new FsError('filesystem target belongs to another execution world', 'FS_PERMISSION_DENIED')
      key = key.slice(prefix.length)
    }
    return { targetKey: key, path: target.displayPath }
  }

  private executionPath(path: string, cwd?: string): string {
    const workspaces = this.ctx.get('conversationWorkspaces')
    if (workspaces === undefined) { this.cwd(cwd); return path }
    const base = cwd === undefined ? WORKSPACE_PATH : workspaces.executionPath(cwd)
    const mapped = workspaces.executionPath(path)
    return posix.isAbsolute(mapped) ? mapped : posix.join(base, mapped)
  }

  private cwd(cwd: string | undefined): typeof WORKSPACE_PATH {
    if (cwd === undefined || cwd === WORKSPACE_PATH || this.config.cwdAliases.includes(cwd)) return WORKSPACE_PATH
    throw new FsError('fs-local-container: cwd is not a configured workspace alias', 'FS_PERMISSION_DENIED')
  }

  private target(value: unknown): FsTarget {
    if (!isRecord(value) || typeof value.targetKey !== 'string' || typeof value.displayPath !== 'string'
      || !isWorkspacePath(value.targetKey) || !isWorkspacePath(value.displayPath)) {
      throw this.protocolFailure()
    }
    const namespace = this.ctx.get('conversationWorkspaces')?.targetNamespace
    const key = namespace === undefined ? value.targetKey : `${namespace}:${value.targetKey}`
    return { targetKey: FsTargetKey(key), displayPath: value.displayPath }
  }

  private info(value: unknown): FsInfo {
    if (!isRecord(value) || typeof value.version !== 'string' || !isInfoType(value.type)) throw this.protocolFailure()
    return {
      version: FsVersion(value.version),
      type: value.type,
      ...value.type === 'file' ? { size: this.size(value.size) } : {},
    }
  }

  private pathInfo(value: unknown): FsPathInfo {
    if (!isRecord(value) || typeof value.version !== 'string' || !isPathInfoType(value.type)) throw this.protocolFailure()
    return {
      version: FsVersion(value.version),
      type: value.type,
      ...value.type === 'file' || value.type === 'symlink' ? { size: this.size(value.size) } : {},
    }
  }

  private dirEntry(value: unknown): FsDirEntry {
    if (!isRecord(value) || typeof value.name !== 'string' || !isInfoType(value.type)) throw this.protocolFailure()
    const target = this.target(value.target)
    const info = value.version === undefined ? undefined : this.info({ version: value.version, type: value.type, size: value.size })
    return {
      name: value.name,
      type: value.type,
      target,
      ...info === undefined ? {} : { version: info.version },
      ...value.type === 'file' ? { size: this.size(value.size) } : {},
    }
  }

  private data(value: unknown): Uint8Array {
    if (!isRecord(value) || typeof value.data !== 'string') throw this.protocolFailure()
    return this.decode(value.data)
  }

  private decode(value: string): Uint8Array {
    const decoded = Buffer.from(value, 'base64')
    if (decoded.toString('base64') !== value) throw this.protocolFailure()
    return decoded
  }

  private text(bytes: Uint8Array): string {
    if (bytes.subarray(0, BINARY_SAMPLE_BYTES).includes(0)) {
      throw new FsError('cannot read container file: binary file', 'FS_NOT_TEXT')
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw new FsError('cannot read container file: invalid UTF-8 text', 'FS_NOT_TEXT')
    }
  }

  private record(value: unknown): { operation: 'create' | 'update'; version: string; before: string | null } {
    if (!isRecord(value) || (value.operation !== 'create' && value.operation !== 'update')
      || typeof value.version !== 'string' || (value.before !== null && typeof value.before !== 'string')) {
      throw this.protocolFailure()
    }
    return { operation: value.operation, version: value.version, before: value.before }
  }

  private editRecord(value: unknown): { version: string; before: string; after: string } {
    if (!isRecord(value) || typeof value.version !== 'string' || typeof value.before !== 'string' || typeof value.after !== 'string') {
      throw this.protocolFailure()
    }
    return { version: value.version, before: value.before, after: value.after }
  }

  private size(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw this.protocolFailure()
    return value
  }

  private byteLimit(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > this.config.maxFileBytes) {
      throw new FsError(`container read limit must be a non-negative safe integer no greater than ${this.config.maxFileBytes}`, 'FS_TOO_LARGE')
    }
  }

  private contentLimit(value: string): void {
    if (Buffer.byteLength(value, 'utf8') > this.config.maxFileBytes) {
      throw new FsError(`container file content exceeds the ${this.config.maxFileBytes}-byte limit`, 'FS_TOO_LARGE')
    }
  }

  private protocolFailure(): FsError {
    return new FsError('container filesystem controller returned an invalid response', 'FS_IO_ERROR')
  }

  private resolveConfig(config: Config): ResolvedConfig {
    const aliases = [...config.cwdAliases]
    if (aliases.some(alias => alias.trim().length === 0 || alias.includes('\0')) || new Set(aliases).size !== aliases.length) {
      throw new Error('fs-local-container: cwdAliases must contain unique non-empty paths')
    }
    this.limit('maxFileBytes', config.maxFileBytes, MAX_FILE_BYTES)
    this.limit('diffBasisMaxBytes', config.diffBasisMaxBytes, config.maxFileBytes)
    this.limit('maxControllerOutputBytes', config.maxControllerOutputBytes, bufferConstants.MAX_LENGTH)
    this.limit('operationTimeoutMs', config.operationTimeoutMs, 2_147_483_647)
    const minimumOutput = 2 * base64Bytes(config.maxFileBytes) + RESPONSE_OVERHEAD_BYTES
    if (config.maxControllerOutputBytes < minimumOutput) {
      throw new Error(`fs-local-container: maxControllerOutputBytes must be at least ${minimumOutput}`)
    }
    return { ...config, cwdAliases: aliases }
  }

  private limit(name: string, value: number, maximum: number): void {
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
      throw new Error(`fs-local-container: ${name} must be a positive safe integer no greater than ${maximum}`)
    }
  }
}

const BINARY_SAMPLE_BYTES = 8192

function base64Bytes(bytes: number): number {
  return Math.ceil(bytes / 3) * 4
}

function normalizeLineEndings(value: string): string {
  return value.replaceAll('\r\n', '\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWorkspacePath(value: string): boolean {
  return value === WORKSPACE_PATH || value.startsWith(`${WORKSPACE_PATH}/`)
}

function isInfoType(value: unknown): value is FsInfo['type'] {
  return value === 'file' || value === 'directory' || value === 'other'
}

function isPathInfoType(value: unknown): value is FsPathInfo['type'] {
  return isInfoType(value) || value === 'symlink'
}

export default LocalContainerFileSystem
