import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LocalContainerRuntime from '@deepseek-ai/dsh-local-container-runtime'
import { apply as validateExecutionWorld } from '@deepseek-ai/dsh-local-container-runtime/startup'
import type {
  LocalContainerRuntimeConfig,
  PodmanContainer,
  PodmanContainerCreate,
  PodmanContainerInspect,
  PodmanControllerExecRequest,
  PodmanControllerExecResult,
  PodmanEngine,
  PodmanImageInspect,
  PodmanInfo,
} from '@deepseek-ai/dsh-local-container-runtime'

// Fake-engine tests control Linux namespace observations while retaining real temporary-directory ownership.
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...original,
    readlink: async (path: Parameters<typeof original.readlink>[0], options?: Parameters<typeof original.readlink>[1]) => {
      if (path === '/proc/self/ns/pid') return 'pid:[1000]'
      if (path === '/proc/self/ns/ipc') return 'ipc:[1001]'
      return await original.readlink(path, options)
    },
  }
})

const IMAGE = 'docker.io/example/dsh-runtime@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const activeFibers = new Set<{ dispose(): Promise<void> }>()

afterEach(async () => {
  const fibers = [...activeFibers]
  activeFibers.clear()
  const results = await Promise.allSettled(fibers.map(async fiber => fiber.dispose()))
  const failure = results.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
})

function config(overrides: Partial<LocalContainerRuntimeConfig> = {}): LocalContainerRuntimeConfig {
  return {
    socketPath: '/run/user/1000/podman/podman.sock',
    manageService: false,
    serviceStartupTimeoutMs: 10_000,
    image: IMAGE,
    user: 'dsh',
    environment: {
      DSH_OPERATION_ID: 'test-operation',
      HOME: '/home/dsh',
      LANG: 'C.UTF-8',
      PATH: '/usr/local/bin:/usr/bin:/bin',
    },
    memoryBytes: 268_435_456,
    nanoCpus: 500_000_000,
    pidsLimit: 128,
    tmpfsBytes: 67_108_864,
    engineRequestTimeoutMs: 10_000,
    maxLiveProcesses: 4,
    lifetimeMs: 60_000,
    stopTimeoutSeconds: 5,
    ...overrides,
  }
}

function readyInfo(overrides: Partial<PodmanInfo> = {}): PodmanInfo {
  return {
    Rootless: true,
    CgroupVersion: '2',
    CgroupDriver: 'systemd',
    MemoryLimit: true,
    CPUCfsQuota: true,
    PidsLimit: true,
    ...overrides,
  }
}

class FakeContainer implements PodmanContainer {
  readonly id = 'container-1'
  private running = false
  readonly stream = new PassThrough()
  readonly inspect = vi.fn(async (): Promise<PodmanContainerInspect> => this.engine.inspectFor(this.request, this.running))
  readonly attach = vi.fn(async () => this.stream)
  readonly start = vi.fn(async (): Promise<void> => { this.running = true })
  readonly wait = vi.fn(async () => this.request.name.startsWith('dsh-local-container-process-')
    ? await this.engine.processWait : { statusCode: 0 })
  readonly resize = vi.fn(async (_rows: number, _cols: number): Promise<void> => {})
  readonly kill = vi.fn(async (_signal: string): Promise<void> => {})
  readonly stop = vi.fn(async (_timeoutSeconds: number): Promise<void> => { this.running = false })
  readonly remove = vi.fn(async (_force: boolean): Promise<void> => {})
  readonly runControl = vi.fn(
    async (_argv: readonly string[], _maxOutputBytes: number): Promise<{ exitCode: number; output: string }> => this.engine.controlResponse,
  )
  readonly runController = vi.fn(async (request: PodmanControllerExecRequest): Promise<PodmanControllerExecResult> => {
    return await this.engine.controllerResponse(request)
  })

  constructor(
    private readonly engine: FakeEngine,
    private readonly request: PodmanContainerCreate,
  ) {}
}

class FakeEngine implements PodmanEngine {
  processWait: Promise<{ statusCode: number }> = Promise.resolve({ statusCode: 0 })
  async containersUsing(): Promise<PodmanContainer[]> { return [] }
  readonly info = vi.fn(async (): Promise<PodmanInfo> => this.infoResponse)
  readonly inspectImage = vi.fn(async (_image: string): Promise<PodmanImageInspect> => this.imageResponse)
  readonly getContainer = vi.fn((name: string): PodmanContainer => {
    const container = this.containers.get(name)
    if (container === undefined) throw new Error('fake container not found')
    return container
  })
  readonly createContainer = vi.fn(async (request: PodmanContainerCreate): Promise<PodmanContainer> => {
    const container = new FakeContainer(this, request)
    this.containers.set(request.name, container)
    if (request.name.startsWith('dsh-local-container-process-')) this.processContainers.push(container)
    else {
      this.request = request
      this.container = container
    }
    if (this.removeFailure !== undefined) container.remove.mockRejectedValue(this.removeFailure)
    if (this.createFailure !== undefined) throw this.createFailure
    return container
  })

  infoResponse: PodmanInfo = readyInfo()
  imageResponse: PodmanImageInspect = { Id: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
  request: PodmanContainerCreate | undefined
  container: FakeContainer | undefined
  readonly containers = new Map<string, FakeContainer>()
  readonly processContainers: FakeContainer[] = []
  removeFailure: unknown
  createFailure: unknown
  controllerResponse: (request: PodmanControllerExecRequest) => Promise<PodmanControllerExecResult> = async () => ({
    exitCode: 0,
    stdout: new Uint8Array(),
    stderr: new Uint8Array(),
  })
  controlResponse = {
    exitCode: 0,
    output: [
      'memory=268435456',
      'swap=0',
      'pids=128',
      'cpu=50000 100000',
      'uid=1000',
      'gid=1000',
      'capeff=0000000000000000',
      'nnp=1',
      'pidns=pid:[1]',
      'ipcns=ipc:[2]',
      'tmpfstype=tmpfs',
      'tmpfsbytes=67108864',
      'netifs=lo,',
      'rootwrite=0',
      'workspacewrite=1',
      'pid1env=RFNIX09QRVJBVElPTl9JRD10ZXN0LW9wZXJhdGlvbgBIT01FPS9ob21lL2RzaABMQU5HPUMuVVRGLTgAUEFUSD0vdXNyL2xvY2FsL2JpbjovdXNyL2JpbjovYmluAA==',
      '',
    ].join('\n'),
  }
  mutateInspection: (inspect: PodmanContainerInspect) => PodmanContainerInspect = inspect => inspect

  inspectFor(request: PodmanContainerCreate, running: boolean): PodmanContainerInspect {
    const bind = request.HostConfig.Binds[0]
    if (bind === undefined) throw new Error('fake engine received no workspace bind')
    const source = bind.slice(0, bind.indexOf(':/workspace:'))
    return this.mutateInspection({
      Id: 'container-1',
      Image: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      State: { Running: running },
      Config: {
        Image: request.Image,
        User: request.User,
        Env: request.Env,
        WorkingDir: request.WorkingDir,
        Entrypoint: request.Entrypoint,
        Cmd: request.Cmd,
      },
      HostConfig: request.HostConfig,
      NetworkDisabled: request.NetworkDisabled,
      Mounts: [
        { Destination: '/workspace', Type: 'bind', Source: source, RW: true },
      ],
    })
  }
}

function runtimeClass(engine: FakeEngine): typeof LocalContainerRuntime {
  return class extends LocalContainerRuntime {
    protected override createEngine(_socketPath: string, _timeoutMs: number): PodmanEngine {
      return engine
    }
  }
}

async function mount(engine: FakeEngine, runtimeConfig = config()): Promise<{
  ctx: Context
  fiber: { dispose(): Promise<void> }
}> {
  const ctx = new Context()
  const fiber = await ctx.plugin(runtimeClass(engine), runtimeConfig)
  activeFibers.add(fiber)
  return { ctx, fiber }
}

async function dispose(fiber: { dispose(): Promise<void> }): Promise<void> {
  activeFibers.delete(fiber)
  await fiber.dispose()
}

describe('local-container execution-world validator', () => {
  it('rejects secret and host-home overrides before allocating process containers', async () => {
    const engine = new FakeEngine()
    const ctx = new Context()
    const fiber = await ctx.plugin(runtimeClass(engine), config())
    try {
      for (const environment of [{ API_TOKEN: 'test-secret' }, { DSH_HOME: '/home/host/.dsh' }]) {
        await expect(ctx.localContainerRuntime.createProcess({
          argv: ['/bin/true'], cwd: '/workspace', environment, tty: false, stdin: false,
        })).rejects.toThrow(/environment entry is invalid|DSH_HOME must refer/)
      }
    } finally {
      await fiber.dispose()
    }
  })

  it('awaits one matching runtime identity', async () => {
    const ctx = new Context()
    const world = {}
    const runtime = { executionWorld: world, getContainer: vi.fn(async () => ({ id: 'container-1', workspacePath: '/workspace' })) }
    ctx.provide('localContainerRuntime', runtime as never)
    ctx.provide('fs', { executionWorld: world } as never)
    ctx.provide('subprocess', { executionWorld: world } as never)
    await expect(validateExecutionWorld(ctx)).resolves.toBeUndefined()
    expect(ctx.get('localContainerExecutionWorld')).toBe(world)
    expect(runtime.getContainer).toHaveBeenCalledOnce()
  })

  it('rejects a split provider pair before runtime work', async () => {
    const ctx = new Context()
    const world = {}
    const runtime = { executionWorld: world, getContainer: vi.fn() }
    ctx.provide('localContainerRuntime', runtime as never)
    ctx.provide('fs', { executionWorld: world } as never)
    ctx.provide('subprocess', { executionWorld: {} } as never)
    await expect(validateExecutionWorld(ctx)).rejects.toThrow(/must share the configured local container execution world/)
    expect(runtime.getContainer).not.toHaveBeenCalled()
  })
})

describe('LocalContainerRuntime', () => {
  it('runs bounded provider controller input and splits its settled streams', async () => {
    const engine = new FakeEngine()
    engine.controllerResponse = async request => ({
      exitCode: 7,
      stdout: request.stdin,
      stderr: new TextEncoder().encode('controller diagnostics'),
    })
    const { ctx, fiber } = await mount(engine)

    const result = await ctx.localContainerRuntime.executeController({
      argv: ['/usr/bin/python3', '-c', 'pass'],
      stdin: new TextEncoder().encode('controller input'),
      maxOutputBytes: 1024,
      deadlineMs: 1000,
    })

    expect(result).toEqual({
      exitCode: 7,
      stdout: new TextEncoder().encode('controller input'),
      stderr: new TextEncoder().encode('controller diagnostics'),
    })
    expect(engine.container?.runController).toHaveBeenCalledWith(expect.objectContaining({
      argv: ['/usr/bin/python3', '-c', 'pass'],
      stdin: new TextEncoder().encode('controller input'),
      maxOutputBytes: 1024,
      signal: expect.any(AbortSignal) as unknown,
    }))
    await dispose(fiber)
  })

  it('closes mutation admission and waits for an existing controller before capture', async () => {
    const engine = new FakeEngine()
    const started = Promise.withResolvers<undefined>(); const completed = Promise.withResolvers<PodmanControllerExecResult>()
    engine.controllerResponse = () => { started.resolve(undefined); return completed.promise }
    const { ctx, fiber } = await mount(engine)
    const request = { argv: ['/usr/bin/python3', '-c', 'pass'], stdin: new Uint8Array(), maxOutputBytes: 1024, deadlineMs: 5000 }
    const writing = ctx.localContainerRuntime.executeController(request)
    await started.promise
    let captured = false
    const saving = ctx.localContainerRuntime.settle(5000, () => { captured = true; return Promise.resolve('saved') })
    await expect(ctx.localContainerRuntime.executeController(request)).rejects.toThrow('being saved')
    expect(captured).toBe(false)
    completed.resolve({ exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() })
    await writing
    expect(await saving).toBe('saved')
    await expect(ctx.localContainerRuntime.executeController(request)).resolves.toMatchObject({ exitCode: 0 })
    await dispose(fiber)
  })

  it('leaves a background writer running when the save barrier expires and can settle after it exits', async () => {
    const engine = new FakeEngine(); const finished = Promise.withResolvers<{ statusCode: number }>()
    engine.processWait = finished.promise
    const { ctx, fiber } = await mount(engine)
    const process = await ctx.localContainerRuntime.createProcess({
      argv: ['/bin/sh', '-c', 'work'], cwd: '/workspace', environment: {}, tty: false, stdin: false,
    })
    try {
      process.stream.resume()
      const capture = vi.fn(() => Promise.resolve('saved'))
      await expect(ctx.localContainerRuntime.settle(10, capture)).rejects.toThrow('active writers')
      expect(capture).not.toHaveBeenCalled()
      expect(engine.processContainers[0]?.stop).not.toHaveBeenCalled()
      expect(engine.processContainers[0]?.kill).not.toHaveBeenCalled()
      engine.processContainers[0]?.stream.push(null)
      expect(engine.processContainers[0]?.stream.writableEnded).toBe(false)
      finished.resolve({ statusCode: 0 }); await process.waitForRemoval()
      expect(await ctx.localContainerRuntime.settle(5000, capture)).toBe('saved')
    } finally { engine.processContainers[0]?.stream.end(); finished.resolve({ statusCode: 0 }); await dispose(fiber) }
  })

  it('owns one sibling process container through attached output and removal', async () => {
    const engine = new FakeEngine()
    const { ctx, fiber } = await mount(engine)

    const process = await ctx.localContainerRuntime.createProcess({
      argv: ['/bin/sh', '-c', 'printf ready'],
      cwd: '/workspace',
      environment: { TERM: 'dumb', DSH_OPERATION_ID: undefined },
      tty: false,
      stdin: false,
    })
    const container = engine.processContainers[0]
    expect(container).toBeDefined()
    const request = engine.createContainer.mock.calls.at(-1)?.[0]
    expect(request).toMatchObject({
      Entrypoint: ['/usr/bin/env'],
      Cmd: ['-i', 'HOME=/home/dsh', 'LANG=C.UTF-8', 'PATH=/usr/local/bin:/usr/bin:/bin', 'TERM=dumb', '/bin/sh', '-c', 'printf ready'],
      User: 'dsh',
      WorkingDir: '/workspace',
      Env: [],
      NetworkDisabled: true,
      Tty: false,
      HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, CapDrop: ['ALL'] },
    })
    process.stream.resume()
    container?.stream.end()
    await expect(process.done).resolves.toEqual({ exitCode: 0 })
    await expect(process.waitForRemoval()).resolves.toBe(true)
    expect(container?.remove).toHaveBeenCalledWith(true)
    await dispose(fiber)
  })

  it('tears down the execution world before surfacing an unproven controller failure', async () => {
    const engine = new FakeEngine()
    engine.controllerResponse = async () => { throw new Error('attachment failed') }
    const { ctx, fiber } = await mount(engine)

    await expect(ctx.localContainerRuntime.executeController({
      argv: ['/usr/bin/python3', '-c', 'pass'],
      stdin: new Uint8Array(),
      maxOutputBytes: 1024,
      deadlineMs: 1000,
    })).rejects.toThrow('attachment failed')
    expect(engine.container?.remove).toHaveBeenCalledOnce()
    await dispose(fiber)
  })

  it('tears down the execution world before settling a cancelled controller execution', async () => {
    const engine = new FakeEngine()
    let started: (() => void) | undefined
    engine.controllerResponse = request => new Promise<PodmanControllerExecResult>((_resolve, reject) => {
      started = () => request.signal?.addEventListener('abort', () =>{  reject(new Error('controller attachment aborted')) }, { once: true })
      started()
    })
    const { ctx, fiber } = await mount(engine)
    const controller = new AbortController()
    const pending = ctx.localContainerRuntime.executeController({
      argv: ['/usr/bin/python3', '-c', 'pass'],
      stdin: new Uint8Array(),
      maxOutputBytes: 1024,
      deadlineMs: 1000,
      signal: controller.signal,
    })

    await vi.waitFor(() =>{  expect(started).toBeDefined() })
    controller.abort()

    await expect(pending).rejects.toThrow('controller operation aborted')
    expect(engine.container?.stop).toHaveBeenCalledOnce()
    expect(engine.container?.remove).toHaveBeenCalledOnce()
    await dispose(fiber)
  })

  it('awaits teardown when cancellation races a settled controller response', async () => {
    const engine = new FakeEngine()
    const controller = new AbortController()
    engine.controllerResponse = async () => {
      controller.abort()
      return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() }
    }
    const { ctx, fiber } = await mount(engine)

    const pending = ctx.localContainerRuntime.executeController({
      argv: ['/usr/bin/python3', '-c', 'pass'],
      stdin: new Uint8Array(),
      maxOutputBytes: 1024,
      deadlineMs: 1000,
      signal: controller.signal,
    })

    await expect(pending).rejects.toThrow('controller operation aborted')
    expect(engine.container?.remove).toHaveBeenCalledOnce()
    await dispose(fiber)
  })

  it('creates, inspects, starts, re-inspects, and removes one constrained rootless Podman world', async () => {
    const engine = new FakeEngine()
    const { ctx, fiber } = await mount(engine)

    await expect(ctx.localContainerRuntime.getContainer()).resolves.toEqual({ id: 'container-1', workspacePath: '/workspace' })

    const request = engine.request
    const container = engine.container
    expect(request).toBeDefined()
    expect(container).toBeDefined()
    expect(engine.info).toHaveBeenCalledOnce()
    expect(engine.inspectImage).toHaveBeenCalledWith(IMAGE)
    expect(request).toMatchObject({
      Image: IMAGE,
      User: 'dsh',
      WorkingDir: '/workspace',
      ReadonlyRootfs: true,
      NetworkDisabled: true,
      Env: [],
      Entrypoint: ['/usr/bin/env'],
      Cmd: ['-i', 'DSH_OPERATION_ID=test-operation', 'HOME=/home/dsh', 'LANG=C.UTF-8', 'PATH=/usr/local/bin:/usr/bin:/bin', '/usr/bin/sleep', 'infinity'],
      HostConfig: {
        NetworkMode: 'none',
        UsernsMode: 'keep-id:uid=1000,gid=1000',
        PidMode: 'private',
        IpcMode: 'private',
        Privileged: false,
        Devices: [],
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        Tmpfs: { '/tmp': 'rw,nosuid,nodev,noexec,size=67108864,mode=1777' },
        Memory: 268_435_456,
        MemorySwap: 268_435_456,
        NanoCpus: 500_000_000,
        PidsLimit: 128,
      },
    })
    const bind = request?.HostConfig.Binds[0]
    expect(bind).toMatch(/^\/tmp\/dsh-local-container-runtime-[^:]+:\/workspace:rw,rprivate,nosuid,nodev,noexec$/u)
    const backingDirectory = bind?.slice(0, bind.indexOf(':/workspace:'))
    expect(backingDirectory).toBeDefined()
    expect((await stat(backingDirectory as string)).mode & 0o077).toBe(0)
    expect(container?.inspect).toHaveBeenCalledTimes(2)
    expect(container?.start).toHaveBeenCalledOnce()
    expect(ctx.localContainerRuntime.diagnostics.containerName).toMatch(/^dsh-local-container-/u)
    expect(ctx.localContainerRuntime.diagnostics.containerId).toBe('container-1')

    await dispose(fiber)

    expect(container?.stop).toHaveBeenCalledWith(5)
    expect(container?.remove).toHaveBeenCalledWith(true)
    expect(existsSync(backingDirectory as string)).toBe(false)
  })

  it.each([
    ['a rootless Engine', readyInfo({ Rootless: false }), /Rootless: true/],
    ['cgroup v2', readyInfo({ CgroupVersion: '1' }), /cgroup v2/],
    ['the systemd cgroup driver', readyInfo({ CgroupDriver: 'cgroupfs' }), /systemd cgroup driver/],
    ['reported resource-control capabilities', readyInfo({ MemoryLimit: false }), /memory and PID limit support/],
  ])('fails closed when Engine info does not prove %s', async (_label, info, message) => {
    const engine = new FakeEngine()
    engine.infoResponse = info
    const { ctx, fiber } = await mount(engine)

    await expect(ctx.localContainerRuntime.getContainer()).rejects.toThrow(message)
    expect(engine.createContainer).not.toHaveBeenCalled()
    await dispose(fiber)
  })

  it.each([
    ['pidns', 'pid:[1]', 'pid:[1000]'],
    ['ipcns', 'ipc:[2]', 'ipc:[1001]'],
  ])('rejects a container sharing the host %s namespace', async (field, isolated, shared) => {
    const engine = new FakeEngine()
    engine.controlResponse.output = engine.controlResponse.output.replace(`${field}=${isolated}`, `${field}=${shared}`)
    const { ctx, fiber } = await mount(engine)

    await expect(ctx.localContainerRuntime.getContainer()).rejects.toThrow(/namespace/)
    expect(engine.container?.remove).toHaveBeenCalledWith(true)
    await dispose(fiber)
  })

  it('fails closed when effective cgroup limits differ from the create request', async () => {
    const engine = new FakeEngine()
    engine.controlResponse = {
      ...engine.controlResponse,
      output: engine.controlResponse.output.replace('memory=268435456', 'memory=max'),
    }
    const { ctx, fiber } = await mount(engine)
    await expect(ctx.localContainerRuntime.getContainer()).rejects.toThrow(/effective memory, swap, or PID cgroup limit/)
    await dispose(fiber).catch(() => {})
  })

  it('rejects an image that declares a writable volume before allocating a world', async () => {
    const engine = new FakeEngine()
    engine.imageResponse = { ...engine.imageResponse, Config: { Volumes: { '/data': {} } } }
    const { ctx, fiber } = await mount(engine)

    await expect(ctx.localContainerRuntime.getContainer()).rejects.toThrow(/declares VOLUME/)
    expect(engine.createContainer).not.toHaveBeenCalled()
    await dispose(fiber)
  })

  it('rolls back a created container and private directory when inspection rejects a control', async () => {
    const engine = new FakeEngine()
    engine.mutateInspection = inspect => ({
      ...inspect,
      HostConfig: { ...inspect.HostConfig, ReadonlyRootfs: false },
    })
    const { ctx, fiber } = await mount(engine)

    await expect(ctx.localContainerRuntime.getContainer()).rejects.toThrow(/read-only root filesystem/)

    const request = engine.request
    const container = engine.container
    const bind = request?.HostConfig.Binds[0]
    const backingDirectory = bind?.slice(0, bind.indexOf(':/workspace:'))
    expect(container?.start).not.toHaveBeenCalled()
    expect(container?.stop).toHaveBeenCalledWith(5)
    expect(container?.remove).toHaveBeenCalledWith(true)
    expect(existsSync(backingDirectory as string)).toBe(false)
    expect(ctx.localContainerRuntime.diagnostics.containerId).toBe('container-1')
    await dispose(fiber)
  })

  it('recovers and removes a named container after an ambiguous create failure', async () => {
    const engine = new FakeEngine()
    engine.createFailure = new Error('create response lost')
    const { ctx, fiber } = await mount(engine)

    await expect(ctx.localContainerRuntime.getContainer()).rejects.toThrow('create response lost')
    const bind = engine.request?.HostConfig.Binds[0]
    const backingDirectory = bind?.slice(0, bind.indexOf(':/workspace:'))
    expect(engine.getContainer).toHaveBeenCalledWith(ctx.localContainerRuntime.containerName)
    expect(engine.container?.remove).toHaveBeenCalledWith(true)
    expect(existsSync(backingDirectory as string)).toBe(false)
    await dispose(fiber).catch(() => {})
  })

  it('retains cleanup failures with the readiness rejection', async () => {
    const engine = new FakeEngine()
    engine.controlResponse = {
      ...engine.controlResponse,
      output: engine.controlResponse.output.replace('rootwrite=0', 'rootwrite=1'),
    }
    const cleanupFailure = new Error('remove failed')
    engine.removeFailure = cleanupFailure
    const { ctx, fiber } = await mount(engine)

    await expect(ctx.localContainerRuntime.getContainer()).rejects.toThrow('local-container-runtime: setup failed and rollback failed')
    await ctx.localContainerRuntime.getContainer().catch((error: unknown) => {
      if (!(error instanceof AggregateError)) throw error
      const rollback = error.errors.find(candidate => candidate instanceof AggregateError)
      if (!(rollback instanceof AggregateError)) throw error
      expect(rollback.errors).toContain(cleanupFailure)
    })
    expect(ctx.localContainerRuntime.diagnostics.containerId).toBe('container-1')
    const bind = engine.request?.HostConfig.Binds[0]
    const backingDirectory = bind?.slice(0, bind.indexOf(':/workspace:'))
    expect(existsSync(backingDirectory as string)).toBe(true)
    engine.container?.remove.mockResolvedValue()
    await dispose(fiber).catch(() => {})
    expect(existsSync(backingDirectory as string)).toBe(false)
  })

  it.each([
    [{ image: 'docker.io/example/dsh-runtime:latest' }, /pinned with an sha256 digest/],
    [{ user: '0:0' }, /explicit non-root/],
    [{ environment: { API_TOKEN: 'secret' } }, /not allowlisted/],
    [{ environment: { DSH_AUTH_COOKIE: 'secret' } }, /not allowlisted/],
    [{ environment: {} }, /explicit non-empty replacement/],
    [{ lifetimeMs: 0 }, /lifetimeMs must be a positive safe integer/],
  ] as const)('rejects unsafe self-contained configuration: %j', async (overrides, message) => {
    const engine = new FakeEngine()
    const ctx = new Context()

    await expect(ctx.plugin(runtimeClass(engine), config(overrides))).rejects.toThrow(message)
    expect(engine.info).not.toHaveBeenCalled()
  })
})
