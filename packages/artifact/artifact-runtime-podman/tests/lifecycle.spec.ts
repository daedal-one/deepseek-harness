/** Engine failures and bounded private presentation lifetimes without external infrastructure. */
import { randomUUID } from 'node:crypto'
import { Duplex } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PodmanContainerCreate,
  PodmanContainerInspect,
  PodmanInfo,
} from '@deepseek-ai/dsh-local-container-runtime'
import type { ArtifactRevision } from '@deepseek-ai/dsh-artifact'
import { PodmanArtifactRuntime } from '../src/index.ts'
import type { Config } from '../src/index.ts'

const fixture = vi.hoisted(() => ({ engine: undefined as unknown as ReturnType<typeof engine> }))
vi.mock('@deepseek-ai/dsh-local-container-runtime/engine', () => ({
  DockerodePodmanEngine: class {
    info = () => fixture.engine.info()
    inspectImage = () => fixture.engine.inspectImage()
    createContainer = (request: PodmanContainerCreate) => fixture.engine.createContainer(request)
    getContainer = () => fixture.engine.container
  },
}))
const config: Config = {
  socketPath: '/engine.sock',
  image: 'registry/browser@sha256:' + 'a'.repeat(64),
  seccompProfilePath: '/seccomp.json',
  user: 'pwuser',
  memoryBytes: 805306368,
  nanoCpus: 1000000000,
  pidsLimit: 256,
  tmpfsBytes: 268435456,
  maxConcurrent: 1,
  maxQueue: 1,
  maxInputBytes: 4096,
  maxOutputBytes: 4096,
  maxLifetimeMs: 100000,
  operationTimeoutMs: 10000,
  width: 640,
  height: 480,
}
function engine() {
  const info = vi.fn(async (): Promise<PodmanInfo> => ({
    Rootless: true,
    CgroupVersion: '2',
    CgroupDriver: 'systemd',
    MemoryLimit: true,
    CPUCfsQuota: true,
    PidsLimit: true,
  }))
  const inspectImage = vi.fn(async () => ({ Config: { Volumes: {} } }))
  let created: PodmanContainerCreate | undefined
  let emit = true
  let responsePatch: Record<string, unknown> = {}
  let kind = 1
  let partition = false
  let transformWire = (bytes: Buffer): Buffer => bytes
  let failure: Error | undefined
  let ended = false
  const pipe = new Duplex({
    read() {},
    write(chunk: Buffer, _encoding, done) {
      if (failure !== undefined) {
        done(failure)
        return
      }
      if (ended) {
        this.push(null)
        done()
        return
      }
      const command = JSON.parse(chunk.toString()) as { sequence: number }
      if (emit) {
        const png = Buffer.alloc(57)
        Buffer.from('89504e470d0a1a0a', 'hex').copy(png)
        png.writeUInt32BE(13, 8)
        png.write('IHDR', 12)
        png.writeUInt32BE(640, 16)
        png.writeUInt32BE(480, 20)
        png[24] = 8
        png[25] = 2
        png.write('IDAT', 37)
        png.write('IEND', 49)
        const json = Buffer.from(
          JSON.stringify({
            sequence: command.sequence,
            png: png.toString('base64'),
            text: 'Ready',
            width: 640,
            height: 480,
            ...responsePatch,
          }) + '\n',
        )
        const header = Buffer.alloc(8)
        header[0] = kind
        header.writeUInt32BE(json.length, 4)
        const bytes = transformWire(Buffer.concat([header, json]))
        if (partition) for (const byte of bytes) this.push(Buffer.from([byte]))
        else this.push(bytes)
      }
      done()
    },
  })
  const container = {
    id: 'container',
    inspect: vi.fn(async (): Promise<PodmanContainerInspect> => ({
      HostConfig: created!.HostConfig,
      Config: { User: config.user },
      Mounts: [],
    })),
    start: vi.fn(async () => {}),
    runControl: vi.fn(async () => ({
      exitCode: 0,
      output: '805306368\n0\n256\n100000 100000\n1001\n0000000000000000\n0000000000000000\n1\n2\nlo\n',
    })),
    attach: vi.fn(async () => pipe),
    remove: vi.fn(async () => {
      pipe.destroy()
    }),
  }
  return {
    info,
    inspectImage,
    container,
    pipe,
    createContainer: vi.fn(async (request: PodmanContainerCreate) => {
      created = request
      return container
    }),
    transformWire: (transform: (bytes: Buffer) => Buffer) => {
      transformWire = transform
    },
    writeFailure: () => {
      failure = new Error('pipe write failed')
    },
    eof: () => {
      ended = true
    },
    silence: () => {
      emit = false
    },
    malformed: (patch: Record<string, unknown>) => {
      responsePatch = patch
    },
    stderr: () => {
      kind = 2
    },
    split: () => {
      partition = true
    },
  }
}
const contexts: Context[] = []
beforeEach(() => {
  fixture.engine = engine()
})
afterEach(async () => {
  fixture.engine.container.remove.mockReset().mockImplementation(async () => {
    fixture.engine.pipe.destroy()
  })
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.useRealTimers()
})
async function mount(patch: Partial<Config> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(PodmanArtifactRuntime, Object.assign({}, config, patch))
  return ctx
}
function input() {
  const revision = {
    artifactId: randomUUID(),
    revisionId: randomUUID(),
    workspaceId: 'a',
    sessionId: 's',
    operationId: randomUUID(),
    parent: null,
    restoredFrom: null,
    title: 'Test',
    entry: 'index.html',
    profile: 'interactive-local',
    capabilities: ['published-assets', 'transient-input'],
    assets: [
      {
        name: 'index.html',
        mediaType: 'text/html',
        sha256: 'a'.repeat(64),
        file: { attachmentId: 'x', name: 'index.html', bytes: 5 },
      },
    ],
    createdAt: new Date().toISOString(),
  } as unknown as ArtifactRevision
  return {
    revision,
    assets: [{ revision, asset: revision.assets[0]!, data: Buffer.from('Ready').toString('base64') }],
  }
}
describe('artifact runtime ownership', () => {
  it('allocates no filesystem, Engine socket, Session or network authority and drains on disposal', async () => {
    const ctx = await mount()
    fixture.engine.split()
    const invocation = await ctx.artifactRuntime.open(input(), new AbortController().signal)
    expect((await invocation.interact(null)).text).toBe('Ready')
    expect(fixture.engine.createContainer.mock.calls[0]?.[0]).toMatchObject({
      NetworkDisabled: true,
      HostConfig: { NetworkMode: 'none', Binds: [], CapDrop: ['ALL'], ReadonlyRootfs: true },
    })
    await ctx.fiber.dispose()
    await invocation.ended
    expect(fixture.engine.container.remove).toHaveBeenCalledTimes(1)
    await expect(invocation.interact({ type: 'key', key: 'Tab' })).rejects.toThrow('revoked')
  })
  it('closes an invocation on upstream cancellation', async () => {
    const ctx = await mount()
    const controller = new AbortController()
    const invocation = await ctx.artifactRuntime.open(input(), controller.signal)
    controller.abort()
    await invocation.ended
    expect(fixture.engine.container.remove).toHaveBeenCalledTimes(1)
  })
  it('rejects admission and excessive input before allocating a second container', async () => {
    const ctx = await mount()
    const controller = new AbortController()
    const invocation = await ctx.artifactRuntime.open(input(), controller.signal)
    await expect(ctx.artifactRuntime.open(input(), controller.signal)).rejects.toThrow('concurrency')
    await invocation.close()
    const oversized = input()
    oversized.assets[0]!.data = 'a'.repeat(4097)
    await expect(ctx.artifactRuntime.open(oversized, controller.signal)).rejects.toThrow('transfer cap')
    expect(fixture.engine.createContainer).toHaveBeenCalledTimes(1)
  })
  it('quarantines after failed removal and retries cleanup during disposal', async () => {
    const ctx = await mount()
    const invocation = await ctx.artifactRuntime.open(input(), new AbortController().signal)
    fixture.engine.container.remove.mockRejectedValueOnce(new Error('engine disconnected'))
    await expect(invocation.close()).rejects.toThrow('engine disconnected')
    await expect(invocation.ended).rejects.toThrow('engine disconnected')
    await expect(ctx.artifactRuntime.open(input(), new AbortController().signal)).rejects.toThrow(
      'unavailable',
    )
    await ctx.fiber.dispose()
    expect(fixture.engine.container.remove).toHaveBeenCalledTimes(2)
  })
  it.each([{ sequence: 99 }, { png: 'invalid' }, { width: 1 }, { unknown: true }])(
    'removes a container that emits a malformed response %j',
    async (patch) => {
      fixture.engine.malformed(patch)
      const ctx = await mount()
      await expect(ctx.artifactRuntime.open(input(), new AbortController().signal)).rejects.toThrow()
      expect(fixture.engine.container.remove).toHaveBeenCalledTimes(1)
    },
  )
  it('refuses renderer stderr and removes the invocation', async () => {
    fixture.engine.stderr()
    const ctx = await mount()
    await expect(ctx.artifactRuntime.open(input(), new AbortController().signal)).rejects.toThrow(
      'invalid stream',
    )
    expect(fixture.engine.container.remove).toHaveBeenCalledTimes(1)
  })
  it('bounds the interaction queue and expires stalled work', async () => {
    const ctx = await mount()
    const invocation = await ctx.artifactRuntime.open(input(), new AbortController().signal)
    vi.useFakeTimers()
    fixture.engine.silence()
    const waiting = invocation.interact({ type: 'text', text: 'wait' })
    void waiting.catch(() => {})
    await expect(invocation.interact({ type: 'key', key: 'Tab' })).rejects.toThrow('queue')
    await vi.advanceTimersByTimeAsync(10001)
    await expect(waiting).rejects.toThrow('deadline')
    await invocation.ended
  })
})

it.each([{ socketPath: 'relative' }, { seccompProfilePath: 'relative' }, { user: 'root' }, { user: '0' }])(
  'refuses an unsafe runtime configuration %j before touching the Engine',
  async (patch) => {
    await expect(mount(patch)).rejects.toThrow('absolute rootless')
    expect(fixture.engine.createContainer).not.toHaveBeenCalled()
  },
)
it.each([
  { Rootless: false },
  { CgroupVersion: '1' },
  { CgroupDriver: 'cgroupfs' },
  { MemoryLimit: false },
  { CPUCfsQuota: false },
  { PidsLimit: false },
])('refuses unqualified Engine resource enforcement %j', async (patch) => {
  const info = await fixture.engine.info()
  fixture.engine.info.mockResolvedValueOnce({ ...info, ...patch })
  await expect(mount()).rejects.toThrow('resource enforcement')
  expect(fixture.engine.createContainer).not.toHaveBeenCalled()
})
it('refuses images with writable volumes while accepting a mount-free image without optional metadata', async () => {
  fixture.engine.inspectImage.mockResolvedValueOnce({ Config: { Volumes: { '/unsafe': {} } } })
  await expect(mount()).rejects.toThrow('writable volumes')
  fixture.engine.inspectImage.mockResolvedValueOnce({} as never)
  const ctx = await mount()
  const invocation = await ctx.artifactRuntime.open(input(), new AbortController().signal)
  await invocation.close()
})
it.each([
  { PidMode: 'host' },
  { IpcMode: 'host' },
  { UsernsMode: 'host' },
  { Privileged: true },
  { Devices: [{}] },
  { Binds: ['/secret:/secret'] },
  { CapDrop: [] },
  { SecurityOpt: [] },
  { Memory: 1 },
])('removes a container whose Engine inspection changed %j', async (patch) => {
  const inspect = fixture.engine.container.inspect.getMockImplementation()!
  fixture.engine.container.inspect.mockImplementationOnce(async () => {
    const value = await inspect()
    return { ...value, HostConfig: { ...value.HostConfig, ...patch } }
  })
  const ctx = await mount()
  await expect(ctx.artifactRuntime.open(input(), new AbortController().signal)).rejects.toThrow(
    'declared isolation',
  )
  expect(fixture.engine.container.remove).toHaveBeenCalledOnce()
  expect(fixture.engine.container.start).not.toHaveBeenCalled()
})
it('refuses host-backed mounts and unknown effective kernel capability bounds', async () => {
  const inspect = fixture.engine.container.inspect.getMockImplementation()!
  fixture.engine.container.inspect.mockImplementationOnce(async () => ({
    ...(await inspect()),
    Mounts: [{ Type: 'bind' }],
  }))
  const ctx = await mount()
  await expect(ctx.artifactRuntime.open(input(), new AbortController().signal)).rejects.toThrow(
    'declared isolation',
  )
  fixture.engine.container.runControl.mockResolvedValueOnce({
    exitCode: 0,
    output: '805306368\n0\n256\n100000 100000\n1001\n0000000000000000\n0000000000000001\n1\n2\nlo\n',
  })
  await expect(ctx.artifactRuntime.open(input(), new AbortController().signal)).rejects.toThrow(
    'effective resource',
  )
})
it('cleans failed allocation and quarantines the runtime if Engine removal cannot be established', async () => {
  fixture.engine.createContainer.mockRejectedValueOnce(new Error('create failed'))
  const ctx = await mount()
  await expect(ctx.artifactRuntime.open(input(), new AbortController().signal)).rejects.toThrow(
    'create failed',
  )
  expect(fixture.engine.container.remove).toHaveBeenCalledOnce()
  fixture.engine.createContainer.mockRejectedValueOnce(new Error('create failed'))
  fixture.engine.container.remove.mockRejectedValueOnce(new Error('remove failed'))
  await expect(ctx.artifactRuntime.open(input(), new AbortController().signal)).rejects.toThrow('quarantined')
  await expect(ctx.artifactRuntime.open(input(), new AbortController().signal)).rejects.toThrow('unavailable')
  await ctx.fiber.dispose()
  expect(fixture.engine.container.remove).toHaveBeenCalledTimes(3)
})
it('requires a closed profile and its exact complete asset manifest before allocating', async () => {
  const ctx = await mount()
  const unsupported = input()
  await expect(
    ctx.artifactRuntime.open(
      { ...unsupported, revision: { ...unsupported.revision, profile: 'host' as never } },
      new AbortController().signal,
    ),
  ).rejects.toThrow('Unsupported')
  await expect(
    ctx.artifactRuntime.open({ ...unsupported, assets: [] }, new AbortController().signal),
  ).rejects.toThrow('exact immutable')
  await expect(
    ctx.artifactRuntime.open(
      {
        ...unsupported,
        assets: [
          {
            ...unsupported.assets[0]!,
            revision: { ...unsupported.revision, revisionId: 'foreign' as never },
          },
        ],
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow('exact immutable')
  await expect(
    ctx.artifactRuntime.open(
      {
        ...unsupported,
        assets: [{ ...unsupported.assets[0]!, asset: { ...unsupported.assets[0]!.asset, name: 'foreign' } }],
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow('exact immutable')
  expect(fixture.engine.createContainer).not.toHaveBeenCalled()
})
it('rejects privilege-shaped, out-of-viewport and oversized input while keeping valid computation available', async () => {
  const ctx = await mount()
  const invocation = await ctx.artifactRuntime.open(input(), new AbortController().signal)
  await expect(invocation.interact({ type: 'shell', command: 'env' } as never)).rejects.toThrow()
  await expect(invocation.interact({ type: 'pointer', x: 640, y: 1 })).rejects.toThrow('viewport')
  await expect(invocation.interact({ type: 'pointer', x: 1, y: 480 })).rejects.toThrow('viewport')
  await expect(invocation.interact({ type: 'text', text: 'x'.repeat(4096) })).rejects.toThrow('input cap')
  expect((await invocation.interact({ type: 'pointer', x: 1, y: 1 })).text).toBe('Ready')
  await invocation.close()
})
it('keeps document rendering available while refusing all transient execution input', async () => {
  const ctx = await mount(),
    document = input()
  const invocation = await ctx.artifactRuntime.open(
    { ...document, revision: { ...document.revision, profile: 'document' } },
    new AbortController().signal,
  )
  expect((await invocation.interact(null)).text).toBe('Ready')
  await expect(invocation.interact({ type: 'key', key: 'Tab' })).rejects.toThrow('Document')
  await invocation.close()
})
it('bounds lifetime and closes a renderer whose output pipe ends unexpectedly', async () => {
  const ctx = await mount({ maxLifetimeMs: 25 })
  const invocation = await ctx.artifactRuntime.open(input(), new AbortController().signal)
  await invocation.ended
  expect(fixture.engine.container.remove).toHaveBeenCalledOnce()
})

it.each([
  [
    'declared frame cap',
    (bytes: Buffer) => {
      bytes.writeUInt32BE(4097, 4)
      return bytes
    },
  ],
  [
    'complete response cap',
    () => {
      const bytes = Buffer.alloc(8 + 4096)
      bytes[0] = 1
      bytes.writeUInt32BE(4096, 4)
      bytes.fill(65, 8)
      return Buffer.concat([bytes, bytes])
    },
  ],
  [
    'unsolicited messages',
    (bytes: Buffer) => {
      const json = Buffer.concat([bytes.subarray(8), Buffer.from('{}\n')])
      bytes.writeUInt32BE(json.length, 4)
      return Buffer.concat([bytes.subarray(0, 8), json])
    },
  ],
] as const)('removes a renderer that violates its %s', async (_name, transform) => {
  fixture.engine.transformWire(transform)
  const ctx = await mount()
  await expect(ctx.artifactRuntime.open(input(), new AbortController().signal)).rejects.toThrow()
  expect(fixture.engine.container.remove).toHaveBeenCalledOnce()
})

it.each(['writeFailure', 'eof'] as const)('removes a renderer after a private pipe %s', async (mode) => {
  fixture.engine[mode]()
  const ctx = await mount()
  await expect(ctx.artifactRuntime.open(input(), new AbortController().signal)).rejects.toThrow()
  expect(fixture.engine.container.remove).toHaveBeenCalledOnce()
})

function staticPng(): Buffer {
  const png = Buffer.alloc(57)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(png)
  png.writeUInt32BE(13, 8)
  png.write('IHDR', 12)
  png.writeUInt32BE(640, 16)
  png.writeUInt32BE(480, 20)
  png[24] = 8
  png[25] = 6
  png.write('IDAT', 37)
  png.write('IEND', 49)
  return png
}
it.each([
  ['short header', () => Buffer.alloc(10)],
  [
    'signature',
    (png: Buffer) => {
      png[0] = 0
      return png
    },
  ],
  [
    'header length',
    (png: Buffer) => {
      png.writeUInt32BE(12, 8)
      return png
    },
  ],
  [
    'header tag',
    (png: Buffer) => {
      png.write('IDAT', 12)
      return png
    },
  ],
  [
    'width',
    (png: Buffer) => {
      png.writeUInt32BE(1, 16)
      return png
    },
  ],
  [
    'height',
    (png: Buffer) => {
      png.writeUInt32BE(1, 20)
      return png
    },
  ],
  [
    'bit depth',
    (png: Buffer) => {
      png[24] = 16
      return png
    },
  ],
  [
    'indexed color',
    (png: Buffer) => {
      png[25] = 3
      return png
    },
  ],
  [
    'compression',
    (png: Buffer) => {
      png[26] = 1
      return png
    },
  ],
  [
    'filter',
    (png: Buffer) => {
      png[27] = 1
      return png
    },
  ],
  [
    'interlace',
    (png: Buffer) => {
      png[28] = 1
      return png
    },
  ],
  [
    'chunk length',
    (png: Buffer) => {
      png.writeUInt32BE(1000, 33)
      return png
    },
  ],
  [
    'animated chunk',
    (png: Buffer) => {
      png.write('acTL', 37)
      return png
    },
  ],
  [
    'absent pixels',
    (png: Buffer) => {
      png.write('IEND', 37)
      return png
    },
  ],
  [
    'end payload',
    (png: Buffer) => {
      png.writeUInt32BE(1, 45)
      return Buffer.concat([png, Buffer.alloc(1)])
    },
  ],
  ['trailing content', (png: Buffer) => Buffer.concat([png, Buffer.alloc(1)])],
  ['incomplete chunks', (png: Buffer) => png.subarray(0, 45)],
] as const)('refuses renderer PNG with %s before Client presentation', async (_name, transform) => {
  fixture.engine.malformed({ png: transform(staticPng()).toString('base64') })
  const ctx = await mount()
  await expect(ctx.artifactRuntime.open(input(), new AbortController().signal)).rejects.toThrow('PNG')
  expect(fixture.engine.container.remove).toHaveBeenCalledOnce()
})
it('accepts a fixed RGBA image and refuses noncanonical base64', async () => {
  fixture.engine.malformed({ png: staticPng().toString('base64') + ' ' })
  const ctx = await mount()
  await expect(ctx.artifactRuntime.open(input(), new AbortController().signal)).rejects.toThrow('canonical')
})
it('revokes queued interactions before they can write to a closed renderer', async () => {
  const ctx = await mount()
  const invocation = await ctx.artifactRuntime.open(input(), new AbortController().signal)
  const queued = invocation.interact({ type: 'key', key: 'Enter' })
  const rejection = expect(queued).rejects.toThrow('revoked')
  await invocation.close()
  await rejection
})

it('refuses a runtime whose Engine persists private presentation streams', async () => {
  const ctx = await mount()
  const inspect = fixture.engine.container.inspect.getMockImplementation()!
  fixture.engine.container.inspect.mockImplementationOnce(async () => {
    const value = await inspect()
    return { ...value, HostConfig: { ...value.HostConfig, LogConfig: { Type: 'journald', Config: {} } } }
  })
  await expect(ctx.artifactRuntime.open(input(), new AbortController().signal)).rejects.toThrow('isolation')
  expect(fixture.engine.container.remove).toHaveBeenCalledOnce()
})

it('refuses execution before class initialization has qualified its Engine and image', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  const runtime = new PodmanArtifactRuntime(ctx, config)
  await expect(runtime.open(input(), new AbortController().signal)).rejects.toThrow('unavailable')
  expect(fixture.engine.info).not.toHaveBeenCalled()
  expect(fixture.engine.createContainer).not.toHaveBeenCalled()
})
it('rejects the invocation lifetime on failed teardown and retains removal for retry', async () => {
  const ctx = await mount()
  const invocation = await ctx.artifactRuntime.open(input(), new AbortController().signal)
  fixture.engine.container.remove.mockRejectedValueOnce(new Error('remove failed'))
  const ended = expect(invocation.ended).rejects.toThrow('remove failed')
  await ctx.fiber.dispose()
  await ended
  await invocation.close()
  expect(fixture.engine.container.remove).toHaveBeenCalledTimes(2)
})

it('accepts an absent empty bind declaration and rejects truncated effective kernel output', async () => {
  const ctx = await mount()
  const inspect = fixture.engine.container.inspect.getMockImplementation()!
  fixture.engine.container.inspect.mockImplementationOnce(async () => {
    const value = await inspect()
    const host = { ...value.HostConfig }
    delete host.Binds
    return { ...value, HostConfig: host }
  })
  const invocation = await ctx.artifactRuntime.open(input(), new AbortController().signal)
  await invocation.close()
  fixture.engine.container.runControl.mockResolvedValueOnce({ exitCode: 0, output: '' })
  await expect(ctx.artifactRuntime.open(input(), new AbortController().signal)).rejects.toThrow(
    'effective resource',
  )
})
it('settles an accepted allocation when disposal revokes it before initialization completes', async () => {
  const ctx = await mount()
  const attach = Promise.withResolvers<Duplex>()
  fixture.engine.container.attach.mockImplementationOnce(() => attach.promise)
  const allocation = ctx.artifactRuntime.open(input(), new AbortController().signal)
  const rejected = expect(allocation).rejects.toThrow('revoked during allocation')
  await vi.waitFor(() => {
    expect(fixture.engine.container.attach).toHaveBeenCalledOnce()
  })
  const disposal = ctx.fiber.dispose()
  attach.resolve(fixture.engine.pipe)
  await rejected
  await disposal
  expect(fixture.engine.container.remove).toHaveBeenCalledOnce()
})
it('normalizes a non-Error private pipe rejection and removes its owned container', async () => {
  const ctx = await mount()
  fixture.engine.pipe[Symbol.asyncIterator] = async function* () {
    throw 'broken iterator'
  }
  await expect(ctx.artifactRuntime.open(input(), new AbortController().signal)).rejects.toThrow(
    'Artifact pipe failed',
  )
  expect(fixture.engine.container.remove).toHaveBeenCalledOnce()
})
it.each(['cancel', 'deadline'] as const)(
  'retains failed asynchronous %s removal for disposal retry',
  async (mode) => {
    const ctx = await mount({ operationTimeoutMs: 20 })
    const controller = new AbortController()
    const invocation = await ctx.artifactRuntime.open(input(), controller.signal)
    fixture.engine.container.remove.mockRejectedValueOnce(new Error('removal failed'))
    const ended = expect(invocation.ended).rejects.toThrow('removal failed')
    if (mode === 'cancel') controller.abort()
    else {
      fixture.engine.silence()
      await expect(invocation.interact({ type: 'key', key: 'Tab' })).rejects.toThrow('deadline')
    }
    await ended
    await ctx.fiber.dispose()
    expect(fixture.engine.container.remove).toHaveBeenCalledTimes(2)
  },
)
it.each(['partial', 'oversized'] as const)('refuses incomplete %s multiline framed output', async (mode) => {
  const ctx = await mount()
  fixture.engine.split()
  fixture.engine.transformWire(() => {
    const parts =
      mode === 'partial'
        ? [Buffer.from('{'), Buffer.from('invalid\n')]
        : [Buffer.alloc(2050, 88), Buffer.alloc(2050, 88)]
    return Buffer.concat(
      parts.map((part) => {
        const header = Buffer.alloc(8)
        header[0] = 1
        header.writeUInt32BE(part.length, 4)
        return Buffer.concat([header, part])
      }),
    )
  })
  await expect(ctx.artifactRuntime.open(input(), new AbortController().signal)).rejects.toThrow()
  expect(fixture.engine.container.remove).toHaveBeenCalledOnce()
})
it('settles a normal pipe EOF caused by owned revocation', async () => {
  const ctx = await mount()
  const invocation = await ctx.artifactRuntime.open(input(), new AbortController().signal)
  fixture.engine.container.remove.mockImplementationOnce(async () => {
    fixture.engine.pipe.push(null)
  })
  await invocation.close()
  await invocation.ended
})

it('refuses an Engine that substitutes the configured seccomp policy', async () => {
  const ctx = await mount()
  const inspect = fixture.engine.container.inspect.getMockImplementation()!
  fixture.engine.container.inspect.mockImplementationOnce(async () => {
    const value = await inspect()
    return {
      ...value,
      HostConfig: { ...value.HostConfig, SecurityOpt: ['no-new-privileges', 'seccomp=/other-policy.json'] },
    }
  })
  await expect(ctx.artifactRuntime.open(input(), new AbortController().signal)).rejects.toThrow('isolation')
  expect(fixture.engine.container.remove).toHaveBeenCalledOnce()
})
