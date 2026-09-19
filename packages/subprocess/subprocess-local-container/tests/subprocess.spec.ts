import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import LocalContainerSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local-container'
import type {
  LocalContainerProcessHandle,
  LocalContainerProcessRequest,
  PodmanControllerExecRequest,
  PodmanControllerExecResult,
} from '@deepseek-ai/dsh-local-container-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'

class FakeProcess implements LocalContainerProcessHandle {
  readonly id = 'process-1'
  readonly stream = new PassThrough()
  readonly tty: boolean
  readonly done: Promise<{ exitCode: number | null; error?: string }>
  private readonly outcome = Promise.withResolvers<{ exitCode: number | null; error?: string }>()
  readonly resize = vi.fn(async () => {})
  readonly inspect = vi.fn(async () => ({ exitCode: 0, output: '1 1' }))
  readonly signal = vi.fn(async () => {})
  readonly terminate = vi.fn(async () => { this.stream.destroy(); this.outcome.resolve({ exitCode: 143 }) })
  readonly waitForRemoval = vi.fn(async () => true)

  constructor(tty: boolean) {
    this.tty = tty
    this.done = this.outcome.promise
  }

  exit(code = 0): void {
    this.outcome.resolve({ exitCode: code })
  }
}

class FakeRuntime {
  readonly executionWorld = Object.freeze({})
  readonly processes: FakeProcess[] = []
  readonly createProcess = vi.fn(async (request: LocalContainerProcessRequest) => {
    const process = new FakeProcess(request.tty)
    this.processes.push(process)
    return process
  })
  readonly controllerCalls: Array<PodmanControllerExecRequest & { deadlineMs: number }> = []
  readonly executeController = vi.fn(async (
    request: PodmanControllerExecRequest & { deadlineMs: number },
  ): Promise<PodmanControllerExecResult> => {
    this.controllerCalls.push(request)
    return { exitCode: 0, stdout: new TextEncoder().encode('/usr/bin/bash'), stderr: new Uint8Array() }
  })
}

const fibers = new Set<{ dispose(): Promise<void> }>()
afterEach(async () => {
  const values = [...fibers]
  fibers.clear()
  await Promise.allSettled(values.map(async fiber => fiber.dispose()))
})

async function setup(): Promise<{ ctx: Context; runtime: FakeRuntime; fiber: { dispose(): Promise<void> } }> {
  const ctx = new Context()
  const runtime = new FakeRuntime()
  ctx.provide('localContainerRuntime', runtime as never)
  const fiber = await ctx.plugin(LocalContainerSubprocessRuntime, {
    cwdAliases: ['/host/workspace'],
    controlOutputBytes: 4096,
    controlTimeoutMs: 1000,
  })
  fibers.add(fiber)
  return { ctx, runtime, fiber }
}

function frame(kind: 1 | 2, value: string): Buffer {
  const payload = Buffer.from(value)
  const header = Buffer.alloc(8)
  header[0] = kind
  header.writeUInt32BE(payload.length, 4)
  return Buffer.concat([header, payload])
}

function spec(overrides: Partial<SubprocessSpawnSpec> = {}): SubprocessSpawnSpec {
  return {
    argv: ['/bin/sh', '-c', 'printf ok'],
    cwd: '/host/workspace',
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: 1000,
    ...overrides,
  }
}

async function text(stream: NodeJS.ReadableStream | undefined): Promise<string> {
  if (stream === undefined) return ''
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array))
  return Buffer.concat(chunks).toString('utf8')
}

describe('LocalContainerSubprocessRuntime', () => {
  it('maps cwd and demultiplexes split stdout and stderr frames', async () => {
    const { ctx, runtime } = await setup()
    const handle = ctx.subprocess.spawn(spec())
    await vi.waitFor(() =>{  expect(runtime.processes).toHaveLength(1) })
    const process = runtime.processes[0]!
    const stdout = text(handle.stdout)
    const stderr = text(handle.stderr)
    const payload = Buffer.concat([frame(1, 'hello'), frame(2, 'error')])
    process.stream.write(payload.subarray(0, 5))
    process.stream.end(payload.subarray(5))
    process.exit(7)

    await expect(handle.done).resolves.toEqual({ exitCode: 7, signal: null })
    await expect(stdout).resolves.toBe('hello')
    await expect(stderr).resolves.toBe('error')
    expect(runtime.createProcess).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/workspace', tty: false }))
  })

  it('keeps an exact byte tail and publishes a sandbox-visible full spill', async () => {
    const { ctx, runtime } = await setup()
    const handle = ctx.subprocess.spawn(spec({
      stdio: { stdin: 'ignore', stdout: { maxBytes: 3, spill: { maxBytes: 16 } }, stderr: { maxBytes: 8 } },
    }))
    await vi.waitFor(() =>{  expect(runtime.processes).toHaveLength(1) })
    const process = runtime.processes[0]!
    process.stream.end(frame(1, 'abcdef'))
    process.exit()

    await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
    expect(handle.collected.stdout?.readFrom(0)).toMatchObject({ text: 'def', nextOffset: 6, lossy: true, spillPath: expect.stringMatching(/^\/workspace\/\.dsh-spill\//u) as unknown })
    expect(Buffer.from(runtime.controllerCalls.at(-1)?.stdin ?? []).toString()).toBe('abcdef')
  })

  it('fails synchronously for an unknown host cwd', async () => {
    const { ctx, runtime } = await setup()
    expect(() => ctx.subprocess.spawn(spec({ cwd: '/other' }))).toThrow(/configured workspace path/)
    expect(runtime.createProcess).not.toHaveBeenCalled()
  })
})
