import { Buffer } from 'node:buffer'
import { Context } from '@deepseek-ai/cordis'
import { FsVersion } from '@deepseek-ai/dsh-fs'
import LocalContainerFileSystem from '@deepseek-ai/dsh-fs-local-container'
import {
  LocalContainerControllerAborted,
  LocalContainerControllerDeadlineExceeded,
  WORKSPACE_PATH,
} from '@deepseek-ai/dsh-local-container-runtime'
import type { PodmanControllerExecRequest, PodmanControllerExecResult } from '@deepseek-ai/dsh-local-container-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface ControllerInput {
  readonly operation: string
  readonly [key: string]: unknown
}

class FakeRuntime {
  readonly executionWorld = Object.freeze({})
  readonly workspacePath = WORKSPACE_PATH
  readonly calls: Array<{ input: ControllerInput; request: PodmanControllerExecRequest }> = []
  handler: (input: ControllerInput, request: PodmanControllerExecRequest) => Promise<PodmanControllerExecResult> =
    async input => response(valueFor(input))

  async executeController(request: PodmanControllerExecRequest & { readonly deadlineMs: number }): Promise<PodmanControllerExecResult> {
    if (request.signal?.aborted === true) throw new LocalContainerControllerAborted()
    const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(request.stdin)) as ControllerInput
    this.calls.push({ input, request })
    return await this.handler(input, request)
  }
}

const fibers = new Set<{ dispose(): Promise<void> }>()

afterEach(async () => {
  const pending = [...fibers]
  fibers.clear()
  const outcomes = await Promise.allSettled(pending.map(async (fiber) =>{  await fiber.dispose() }))
  const failure = outcomes.find(outcome => outcome.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
})

function config(overrides: Partial<LocalContainerFileSystem['config']> = {}) {
  return {
    cwdAliases: ['/host/session-workspace'],
    maxFileBytes: 64,
    diffBasisMaxBytes: 32,
    maxControllerOutputBytes: 4096,
    operationTimeoutMs: 1000,
    ...overrides,
  }
}

async function setup(runtime = new FakeRuntime(), options: Partial<LocalContainerFileSystem['config']> = {}): Promise<{
  ctx: Context
  fs: LocalContainerFileSystem
  runtime: FakeRuntime
  fiber: { dispose(): Promise<void> }
}> {
  const ctx = new Context()
  ctx.provide('localContainerRuntime', runtime as never)
  const fiber = await ctx.plugin(LocalContainerFileSystem, config(options))
  fibers.add(fiber)
  return { ctx, fs: ctx.fs as LocalContainerFileSystem, runtime, fiber }
}

function response(value: unknown, exitCode = 0): PodmanControllerExecResult {
  return {
    exitCode,
    stdout: new TextEncoder().encode(JSON.stringify({ ok: true, value })),
    stderr: new Uint8Array(),
  }
}

function failure(code: string): PodmanControllerExecResult {
  return {
    exitCode: 0,
    stdout: new TextEncoder().encode(JSON.stringify({ ok: false, code })),
    stderr: new Uint8Array(),
  }
}

function bytes(value: string | readonly number[]): string {
  return Buffer.from(typeof value === 'string' ? value : Uint8Array.from(value)).toString('base64')
}

function target(path = '/workspace/file.txt') {
  return { targetKey: path, displayPath: path }
}

function valueFor(input: ControllerInput): unknown {
  switch (input.operation) {
    case 'resolve': return target('/workspace/file.txt')
    case 'stat': return { version: 'v1', type: 'file', size: 5 }
    case 'lstat': return { version: 'p1', type: 'file', size: 5 }
    case 'readText': return { data: bytes('hello') }
    case 'readBytes': return { data: bytes([1, 2, 3]) }
    case 'readByteRange': return { data: bytes([2, 3]) }
    case 'listDir': return [{ name: 'file.txt', type: 'file', version: 'v1', size: 5, target: target() }]
    case 'writeText': return { operation: 'update', version: 'v2', before: bytes('before') }
    case 'editText': return { version: 'v3', before: bytes('before'), after: bytes('after') }
    default: throw new Error(`unexpected controller operation: ${input.operation}`)
  }
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code })
}

describe('LocalContainerFileSystem', () => {
  it('registers ctx.fs with the runtime owner identity and removes it on disposal', async () => {
    const { ctx, fs, runtime, fiber } = await setup()

    expect(fs.executionWorld === runtime.executionWorld).toBe(true)
    expect(fs.processPathFromHostPath('/host/session-workspace/file.txt') === undefined).toBe(true)
    expect(ctx.fs !== undefined).toBe(true)

    fibers.delete(fiber)
    await fiber.dispose()
    expect(ctx.fs).toBeUndefined()
  })

  it('maps configured Session cwd aliases to /workspace and rejects unknown cwd without exposing it', async () => {
    const runtime = new FakeRuntime()
    runtime.handler = async input => input.operation === 'resolve' && input.path === '../host-secret'
      ? failure('FS_PERMISSION_DENIED')
      : response(valueFor(input))
    const { fs } = await setup(runtime)

    await expect(fs.resolve('src/file.ts', { cwd: '/host/session-workspace' })).resolves.toEqual({
      targetKey: '/workspace/file.txt',
      displayPath: '/workspace/file.txt',
    })
    expect(runtime.calls[0]?.input).toMatchObject({ operation: 'resolve', path: 'src/file.ts' })
    await expectCode(fs.resolve('file.ts', { cwd: '/host/unknown-secret' }), 'FS_PERMISSION_DENIED')
    await expectCode(fs.resolve('../host-secret'), 'FS_PERMISSION_DENIED')
    expect(runtime.calls.at(-1)?.input).toMatchObject({ operation: 'resolve', path: '../host-secret' })
    await expect(fs.resolve('file.ts', { cwd: WORKSPACE_PATH })).resolves.toBeDefined()
  })

  it('fails closed when a controller response tries to expose a backing path', async () => {
    const runtime = new FakeRuntime()
    runtime.handler = async () => response(target('/tmp/dsh-local-container-runtime-private/file.txt'))
    const { fs } = await setup(runtime)

    await expectCode(fs.resolve('file.txt'), 'FS_IO_ERROR')
    await expect(fs.resolve('file.txt')).rejects.not.toThrow('/tmp/dsh-local-container-runtime-private')
  })

  it('uses canonical container targets for symlink aliases and POSIX process paths', async () => {
    const runtime = new FakeRuntime()
    runtime.handler = async (input) => {
      if (input.operation === 'resolve') return response(target('/workspace/real/file.txt'))
      if (input.operation === 'lstat') return response({ version: 'link-v1', type: 'symlink', size: 8 })
      throw new Error(`unexpected controller operation: ${input.operation}`)
    }
    const { fs } = await setup(runtime)

    const alias = await fs.resolve('link/file.txt')
    const real = await fs.resolve('real/file.txt')
    expect(alias.targetKey).toBe(real.targetKey)
    expect(fs.processPath(alias)).toBe('/workspace/real/file.txt')
    expect(fs.fileUrl(alias)).toBe('file:///workspace/real/file.txt')
    expect(fs.contains(await fs.resolve('real'), alias)).toBe(true)
    await expect(fs.lstat('link', { cwd: '/host/session-workspace' })).resolves.toMatchObject({ type: 'symlink' })
  })

  it('adapts every filesystem primitive through bounded controller results', async () => {
    const { fs } = await setup()
    const file = await fs.resolve('file.txt')

    await expect(fs.stat(file)).resolves.toEqual({ version: FsVersion('v1'), type: 'file', size: 5 })
    await expect(fs.lstat('file.txt')).resolves.toEqual({ version: FsVersion('p1'), type: 'file', size: 5 })
    await expect(fs.readText(file)).resolves.toBe('hello')
    await expect(fs.readBytes(file, undefined, 3).then(Array.from)).resolves.toEqual([1, 2, 3])
    await expect(fs.readByteRange(file, { offset: 1, length: 2 }).then(Array.from)).resolves.toEqual([2, 3])
    await expect(fs.listDir(await fs.resolve('.'))).resolves.toEqual([{
      name: 'file.txt',
      type: 'file',
      version: FsVersion('v1'),
      size: 5,
      target: { targetKey: '/workspace/file.txt', displayPath: '/workspace/file.txt' },
    }])
    const stream = await fs.streamText(file)
    let streamed = ''
    for await (const chunk of stream) streamed += chunk
    expect(streamed).toBe('hello')
    await expect(fs.writeText(file, 'next', { kind: 'replaceIfVersion', version: FsVersion('v1') })).resolves.toEqual({
      operation: 'update', version: FsVersion('v2'), before: 'before', after: 'next',
    })
    await expect(fs.editText(file, { oldString: 'before', newString: 'after', replaceAll: false }, { version: FsVersion('v2') })).resolves.toEqual({
      version: FsVersion('v3'), before: 'before', after: 'after',
    })
  })

  it('enforces exact read and UTF-8 bounds before accepting controller output', async () => {
    const runtime = new FakeRuntime()
    const { fs } = await setup(runtime, { maxFileBytes: 6, diffBasisMaxBytes: 3 })
    const file = await fs.resolve('file.txt')

    await expect(fs.readBytes(file, undefined, 6).then(Array.from)).resolves.toEqual([1, 2, 3])
    await expectCode(fs.readBytes(file, undefined, 7), 'FS_TOO_LARGE')
    await expectCode(fs.readByteRange(file, { offset: 0, length: 7 }), 'FS_TOO_LARGE')
    runtime.handler = async input => input.operation === 'readText'
      ? response({ data: bytes([0xc3, 0x28]) })
      : response(valueFor(input))
    await expectCode(fs.readText(file), 'FS_NOT_TEXT')
    runtime.handler = async input => input.operation === 'readText'
      ? response({ data: bytes([97, 0, 98]) })
      : response(valueFor(input))
    await expectCode(fs.readText(file), 'FS_NOT_TEXT')
    await expectCode(fs.writeText(file, '1234567'), 'FS_TOO_LARGE')
  })

  it('serializes version-guarded mutations per canonical target and preserves stale errors', async () => {
    const runtime = new FakeRuntime()
    let release: (() => void) | undefined
    let writes = 0
    runtime.handler = (input) => {
      if (input.operation !== 'writeText') return Promise.resolve(response(valueFor(input)))
      writes += 1
      if (writes === 1) {
        return new Promise((resolve) => { release = () =>{  resolve(response({ operation: 'update', version: 'v2', before: null })) } })
      }
      return Promise.resolve(failure('FS_STALE_VERSION'))
    }
    const { fs } = await setup(runtime)
    const file = await fs.resolve('file.txt')
    const first = fs.writeText(file, 'first', { kind: 'replaceIfVersion', version: FsVersion('v1') })
    const second = fs.writeText(file, 'second', { kind: 'replaceIfVersion', version: FsVersion('v1') })

    await vi.waitFor(() =>{  expect(writes).toBe(1) })
    expect(release).toBeDefined()
    release?.()

    await expect(first).resolves.toMatchObject({ version: FsVersion('v2'), before: null })
    await expectCode(second, 'FS_STALE_VERSION')
    expect(writes).toBe(2)
  })

  it('maps cancellation and deadline controller outcomes without returning engine diagnostics', async () => {
    const runtime = new FakeRuntime()
    const { fs } = await setup(runtime)
    const file = await fs.resolve('file.txt')
    runtime.handler = async () => { throw new LocalContainerControllerDeadlineExceeded() }

    await expectCode(fs.readText(file), 'FS_IO_ERROR')
    runtime.handler = async (_input, request) => await new Promise<PodmanControllerExecResult>((_resolve, reject) => {
      request.signal?.addEventListener('abort', () =>{  reject(new LocalContainerControllerAborted()) }, { once: true })
    })
    const controller = new AbortController()
    const read = fs.readText(file, controller.signal)
    await vi.waitFor(() =>{  expect(runtime.calls.at(-1)?.request.signal).toBeDefined() })
    controller.abort()
    await expectCode(read, 'FS_ABORTED')
  })

  it('translates controller error codes without leaking stderr or host paths', async () => {
    const runtime = new FakeRuntime()
    runtime.handler = async () => ({
      exitCode: 0,
      stdout: new TextEncoder().encode(JSON.stringify({ ok: false, code: 'FS_NOT_FOUND' })),
      stderr: new TextEncoder().encode('/tmp/dsh-local-container-runtime-private/secret'),
    })
    const { fs } = await setup(runtime)

    await expectCode(fs.resolve('missing.txt'), 'FS_NOT_FOUND')
    await expect(fs.resolve('missing.txt')).rejects.not.toThrow('/tmp/dsh-local-container-runtime-private')
  })
})
