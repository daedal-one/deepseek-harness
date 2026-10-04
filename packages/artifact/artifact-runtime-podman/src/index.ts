/** Independent rootless browser provider; no Session world, mounts, or RPC enters an invocation. @module */
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as wire } from 'zod'
import { ArtifactRuntime } from '@deepseek-ai/dsh-artifact-runtime'
import type {
  ArtifactFrame,
  ArtifactInvocation,
  ArtifactInvocationId,
  ArtifactRuntimeInput,
  ArtifactRuntimeInteraction,
} from '@deepseek-ai/dsh-artifact-runtime'
import { DockerodePodmanEngine } from '@deepseek-ai/dsh-local-container-runtime/engine'
import type { PodmanContainer, PodmanEngine } from '@deepseek-ai/dsh-local-container-runtime'
import type { Duplex } from 'node:stream'

/** Deployment-specific bounds and pinned trusted image. Security restrictions cannot be configured away. */
export interface Config {
  /** Absolute rootless Engine API socket on the Harness host. */
  socketPath: string
  /** Trusted renderer image pinned by registry digest. */
  image: string
  /** Absolute confined seccomp profile on the Engine host. */
  seccompProfilePath: string
  /** Non-root renderer image user. */
  user: string
  /** Invocation memory cap; swap is disabled. */
  memoryBytes: number
  /** Invocation CPU quota in billionths of one CPU. */
  nanoCpus: number
  /** Maximum processes in the invocation cgroup. */
  pidsLimit: number
  /** Maximum private temporary filesystem bytes. */
  tmpfsBytes: number
  /** Maximum active or allocating browser invocations. */
  maxConcurrent: number
  /** Maximum pending input operations per invocation. */
  maxQueue: number
  /** Maximum complete initialization or interaction command bytes. */
  maxInputBytes: number
  /** Maximum complete presentation response bytes. */
  maxOutputBytes: number
  /** Maximum invocation lifetime in milliseconds. */
  maxLifetimeMs: number
  /** Engine operation and browser response deadline in milliseconds. */
  operationTimeoutMs: number
  /** Fixed preview viewport width in pixels. */
  width: number
  /** Fixed preview viewport height in pixels. */
  height: number
}
/** Required validated runtime configuration. */
export const Config: z<Config> = z.object({
  seccompProfilePath: z.string().required(),
  socketPath: z.string().required(),
  image: z
    .string()
    .pattern(/@sha256:[a-f0-9]{64}$/u)
    .required(),
  user: z.string().required(),
  memoryBytes: z.number().step(1).min(1).required(),
  nanoCpus: z.number().step(1).min(1).required(),
  pidsLimit: z.number().step(1).min(1).required(),
  tmpfsBytes: z.number().step(1).min(1).required(),
  maxConcurrent: z.number().step(1).min(1).required(),
  maxQueue: z.number().step(1).min(1).required(),
  maxInputBytes: z.number().step(1).min(1).required(),
  maxOutputBytes: z.number().step(1).min(1).required(),
  maxLifetimeMs: z.number().step(1).min(1).max(2147483647).required(),
  operationTimeoutMs: z.number().step(1).min(1).max(2147483647).required(),
  width: z.number().step(1).min(1).required(),
  height: z.number().step(1).min(1).required(),
})
const responseSchema = wire.strictObject({
  sequence: wire.number().int().nonnegative(),
  png: wire.string(),
  text: wire.string(),
  width: wire.number().int().positive(),
  height: wire.number().int().positive(),
})
const inputSchema = wire.discriminatedUnion('type', [
  wire.strictObject({
    type: wire.literal('pointer'),
    x: wire.number().nonnegative(),
    y: wire.number().nonnegative(),
  }),
  wire.strictObject({
    type: wire.literal('key'),
    key: wire.enum([
      'Tab',
      'Enter',
      'Space',
      'Backspace',
      'Delete',
      'Escape',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
    ]),
  }),
  wire.strictObject({ type: wire.literal('text'), text: wire.string() }),
])
/** Artifact execution is always independently allocated and verified. */
export class PodmanArtifactRuntime extends ArtifactRuntime {
  static Config = Config
  private readonly engine: PodmanEngine
  private readonly active = new Set<ArtifactInvocation>()
  private readonly allocations = new Set<Promise<ArtifactInvocation>>()
  private readonly orphaned = new Set<PodmanContainer>()
  private closing = false
  private qualified = false
  /**
   * @param ctx - effect owner.
   * @param config - pinned image and complete resource caps.
   */
  constructor(
    ctx: Context,
    private readonly config: Config,
  ) {
    super(ctx)
    this.engine = new DockerodePodmanEngine(config.socketPath, config.operationTimeoutMs)
  }
  /** Qualify engine resource controls and image-declared mounts before registering execution. */
  protected async [Service.init](): Promise<void> {
    if (
      !this.config.socketPath.startsWith('/') ||
      !this.config.seccompProfilePath.startsWith('/') ||
      this.config.user === 'root' ||
      this.config.user === '0'
    )
      throw new Error('Artifact runtime requires an absolute rootless socket and non-root image user.')
    const info = await this.engine.info()
    if (
      info.Rootless !== true ||
      info.CgroupVersion !== '2' ||
      info.CgroupDriver !== 'systemd' ||
      info.MemoryLimit !== true ||
      info.CPUCfsQuota === false ||
      info.PidsLimit !== true
    )
      throw new Error('Artifact runtime requires verified rootless cgroup-v2 resource enforcement.')
    const image = await this.engine.inspectImage(this.config.image)
    if (Object.keys(image.Config?.Volumes ?? {}).length !== 0)
      throw new Error('Artifact runtime image must not declare writable volumes.')
    this.qualified = true
    this.ctx.effect(
      () => async () => {
        this.closing = true
        await Promise.allSettled(this.allocations)
        const removals = await Promise.allSettled([
          ...[...this.active].map(invocation => invocation.close()),
          ...[...this.orphaned].map(container => this.removeOrphan(container)),
        ])
        const failures = removals.flatMap(result =>
          result.status === 'rejected' ? [result.reason as unknown] : [],
        )
        if (failures.length !== 0)
          throw new AggregateError(failures, 'Artifact runtime removal remains unconfirmed.')
      },
      'artifacts.runtimeClose',
    )
  }
  /** @inheritdoc */
  open(input: ArtifactRuntimeInput, signal: AbortSignal): Promise<ArtifactInvocation> {
    if (
      !this.qualified ||
      this.closing ||
      this.active.size + this.allocations.size >= this.config.maxConcurrent
    )
      return Promise.reject(new Error('Artifact runtime is unavailable or at its concurrency limit.'))
    const promise = this.allocate(input, signal)
    this.allocations.add(promise)
    void promise.then(
      () => {
        this.allocations.delete(promise)
      },
      () => {
        this.allocations.delete(promise)
      },
    )
    return promise
  }
  private async allocate(input: ArtifactRuntimeInput, signal: AbortSignal): Promise<ArtifactInvocation> {
    signal.throwIfAborted()
    const { config } = this
    if (Buffer.byteLength(JSON.stringify(input)) > config.maxInputBytes)
      throw new Error('Complete artifact runtime input exceeds the transfer cap.')
    const profile: string = input.revision.profile
    if (profile !== 'document' && profile !== 'interactive-local')
      throw new Error('Unsupported artifact runtime profile.')
    if (
      input.assets.length !== input.revision.assets.length ||
      input.assets.some(
        (content, index) =>
          content.revision.revisionId !== input.revision.revisionId ||
          content.asset.name !== input.revision.assets[index]?.name,
      )
    )
      throw new Error('Runtime assets must match the exact immutable revision manifest.')
    const id = randomUUID() as ArtifactInvocationId
    const name = 'dsh-artifact-' + id
    let container: PodmanContainer | undefined
    let invocation: ArtifactInvocation | undefined
    try {
      container = await this.engine.createContainer({
        name,
        Image: config.image,
        Entrypoint: [
          '/usr/bin/env',
          '-i',
          'PATH=/usr/local/bin:/usr/bin:/bin',
          'HOME=/tmp',
          'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
          'node',
          '/opt/artifact/controller.mjs',
        ],
        Cmd: [],
        User: config.user,
        WorkingDir: '/opt/artifact',
        Env: ['PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/tmp', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright'],
        ReadonlyRootfs: true,
        NetworkDisabled: true,
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        OpenStdin: true,
        StdinOnce: true,
        Tty: false,
        HostConfig: {
          LogConfig: { Type: 'none', Config: {} },
          NetworkMode: 'none',
          UsernsMode: '',
          PidMode: 'private',
          IpcMode: 'private',
          Privileged: false,
          Devices: [],
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges', 'seccomp=' + config.seccompProfilePath],
          Tmpfs: { '/tmp': 'rw,nosuid,nodev,size=' + String(config.tmpfsBytes) },
          Binds: [],
          ReadonlyRootfs: true,
          Memory: config.memoryBytes,
          MemorySwap: config.memoryBytes,
          NanoCpus: config.nanoCpus,
          PidsLimit: config.pidsLimit,
        },
      })
      const inspection = await container.inspect()
      const host = inspection.HostConfig
      if (
        host?.ReadonlyRootfs !== true ||
        host.LogConfig?.Type !== 'none' ||
        host.NetworkMode !== 'none' ||
        host.Privileged !== false ||
        host.PidMode !== 'private' ||
        host.IpcMode !== 'private' ||
        host.UsernsMode !== '' ||
        (host.Devices?.length ?? 0) !== 0 ||
        host.Memory !== config.memoryBytes ||
        host.MemorySwap !== config.memoryBytes ||
        host.NanoCpus !== config.nanoCpus ||
        host.PidsLimit !== config.pidsLimit ||
        (host.CapDrop?.length ?? 0) === 0 ||
        host.SecurityOpt?.some(value => value.startsWith('no-new-privileges')) !== true ||
        !host.SecurityOpt.includes('seccomp=' + config.seccompProfilePath) ||
        inspection.Config?.User !== config.user ||
        (inspection.Mounts ?? []).some(mount => mount.Type !== 'tmpfs') ||
        (host.Binds?.length ?? 0) !== 0
      )
        throw new Error(
          'Artifact container did not retain its declared isolation and resource limits: ' +
            JSON.stringify({
              readonly: host?.ReadonlyRootfs,
              logging: host?.LogConfig?.Type,
              network: host?.NetworkMode,
              privileged: host?.Privileged,
              pid: host?.PidMode,
              ipc: host?.IpcMode,
              userns: host?.UsernsMode,
              memory: host?.Memory,
              swap: host?.MemorySwap,
              cpu: host?.NanoCpus,
              pids: host?.PidsLimit,
              caps: host?.CapDrop,
              security: host?.SecurityOpt,
              user: inspection.Config?.User,
              mounts: inspection.Mounts?.map(mount => mount.Type),
              binds: host?.Binds?.length,
            }),
        )
      await container.start()
      const facts = await container.runControl(
        [
          '/bin/sh',
          '-c',
          'set -eu; cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/pids.max /sys/fs/cgroup/cpu.max; id -u; sed -n "s/^CapEff:[[:space:]]*//p;s/^CapBnd:[[:space:]]*//p;s/^NoNewPrivs:[[:space:]]*//p;s/^Seccomp:[[:space:]]*//p" /proc/self/status; find /sys/class/net -mindepth 1 -maxdepth 1 -printf "%f\\n" | sort',
        ],
        config.maxOutputBytes,
      )
      const values = facts.output.trim().split(/\r?\n/u)
      const [quota, period] = values[3]?.split(' ') ?? []
      if (
        facts.exitCode !== 0 ||
        values[0] !== String(config.memoryBytes) ||
        values[1] !== '0' ||
        values[2] !== String(config.pidsLimit) ||
        quota === undefined ||
        period === undefined ||
        !/^\d+$/u.test(quota) ||
        !/^\d+$/u.test(period) ||
        quota === '0' ||
        period === '0' ||
        BigInt(quota) * 1000000000n !== BigInt(period) * BigInt(config.nanoCpus) ||
        !/^[1-9][0-9]*$/u.test(values[4] ?? '') ||
        values[5] !== '0000000000000000' ||
        values[6] !== '0000000000000000' ||
        values[7] !== '1' ||
        values[8] !== '2' ||
        values.slice(9).join(',') !== 'lo'
      )
        throw new Error('Artifact sandbox effective resource or privilege controls are unsafe.')
      signal.throwIfAborted()
      const stream = await container.attach({ stdin: true, stdout: true, stderr: true })
      const owner = new BrowserInvocation(
        id,
        input,
        container,
        stream,
        config,
        signal,
        () => {
          this.active.delete(owner)
        },
        () => {
          this.closing = true
        },
      )
      invocation = owner
      this.active.add(owner)
      await owner.initialize()
      if (this.closing) {
        await owner.close()
        throw new Error('Artifact runtime was revoked during allocation.')
      }
      return owner
    } catch (error) {
      if (invocation !== undefined) await invocation.close()
      else {
        const orphan = container ?? this.engine.getContainer(name)
        this.orphaned.add(orphan)
        try {
          await this.removeOrphan(orphan)
        } catch (removalError) {
          this.closing = true
          throw new AggregateError(
            [error, removalError],
            'Artifact allocation cleanup failed; runtime is quarantined.',
          )
        }
      }
      throw error
    }
  }
  private async removeOrphan(container: PodmanContainer): Promise<void> {
    await container.remove(true)
    this.orphaned.delete(container)
  }
}

interface Pending {
  sequence: number
  resolve: (frame: ArtifactFrame) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}
/** Owns one private pipe, one browser container, and one quiescent disposal. */
class BrowserInvocation implements ArtifactInvocation {
  readonly ended: Promise<void>
  private finish!: () => void
  private endFailed!: (error: unknown) => void
  private pending: Pending | undefined
  private buffer: Buffer = Buffer.alloc(0)
  private lines: Buffer = Buffer.alloc(0)
  private sequence = 0
  private queue = 0
  private tail: Promise<void> = Promise.resolve()
  private closePromise: Promise<void> | undefined
  private revoked = false
  private readonly lifetime: ReturnType<typeof setTimeout>
  private readonly reading: Promise<void>
  private latest!: ArtifactFrame
  private readonly onAbort = (): void => {
    void this.close().catch(() => {})
  }
  constructor(
    readonly id: ArtifactInvocationId,
    private readonly input: ArtifactRuntimeInput,
    private readonly container: PodmanContainer,
    private readonly stream: Duplex,
    private readonly config: Config,
    private readonly signal: AbortSignal,
    private readonly released: () => void,
    private readonly removalFailed: () => void,
  ) {
    this.ended = new Promise<void>((resolve, reject) => {
      this.finish = resolve
      this.endFailed = reject
    })
    // The preview owner observes removal failure through ended.
    void this.ended.catch(() => {})
    this.reading = this.read().catch((error: unknown) => {
      this.fail(error instanceof Error ? error : new Error('Artifact pipe failed.', { cause: error }))
      void this.close().catch(() => {})
    })
    this.lifetime = setTimeout(this.onAbort, config.maxLifetimeMs)
    signal.addEventListener('abort', this.onAbort, { once: true })
  }
  async initialize(): Promise<void> {
    this.latest = await this.send({
      type: 'open',
      entry: this.input.revision.entry,
      profile: this.input.revision.profile,
      assets: this.input.assets.map(content => ({
        name: content.asset.name,
        mediaType: content.asset.mediaType,
        data: content.data,
      })),
      width: this.config.width,
      height: this.config.height,
      timeoutMs: this.config.operationTimeoutMs,
      maxOutputBytes: this.config.maxOutputBytes,
    })
  }
  /** @inheritdoc */
  interact(input: ArtifactRuntimeInteraction | null): Promise<ArtifactFrame> {
    if (this.revoked || this.signal.aborted)
      return Promise.reject(new Error('Artifact invocation is revoked.'))
    if (input === null) return Promise.resolve(this.latest)
    if (this.input.revision.profile !== 'interactive-local')
      return Promise.reject(new Error('Document artifacts do not accept execution input.'))
    const checked = inputSchema.safeParse(input)
    if (!checked.success) return Promise.reject(checked.error)
    const parsed = checked.data
    if (parsed.type === 'pointer' && (parsed.x >= this.config.width || parsed.y >= this.config.height))
      return Promise.reject(new Error('Artifact pointer is outside the viewport.'))
    if (this.queue >= this.config.maxQueue)
      return Promise.reject(new Error('Artifact interaction queue is full.'))
    this.queue++
    const promise = this.tail
      .then(async () => {
        const result = await this.send(parsed)
        this.latest = result
        return result
      })
      .finally(() => {
        this.queue--
      })
    this.tail = promise.then(
      () => {},
      () => {},
    )
    return promise
  }
  /** @inheritdoc */
  close(): Promise<void> {
    this.revoked = true
    this.closePromise ??= this.dispose().then(
      () => {
        this.finish()
      },
      (error: unknown) => {
        this.closePromise = undefined
        this.removalFailed()
        this.endFailed(error)
        throw error
      },
    )
    return this.closePromise
  }
  private async dispose(): Promise<void> {
    clearTimeout(this.lifetime)
    this.signal.removeEventListener('abort', this.onAbort)
    this.fail(new Error('Artifact invocation ended.'))
    this.stream.destroy()
    try {
      await this.container.remove(true)
    } finally {
      await this.reading
      await this.tail
    }
    this.released()
  }
  private send(command: object): Promise<ArtifactFrame> {
    if (this.revoked || this.signal.aborted)
      return Promise.reject(new Error('Artifact invocation is revoked.'))
    const sequence = this.sequence++
    const bytes = Buffer.from(JSON.stringify({ ...command, sequence }) + '\n')
    if (bytes.byteLength > this.config.maxInputBytes)
      return Promise.reject(new Error('Artifact command exceeds the input cap.'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error('Artifact execution exceeded its operation deadline.'))
        void this.close().catch(() => {})
      }, this.config.operationTimeoutMs)
      this.pending = { sequence, resolve, reject, timer }
      this.stream.write(bytes, (error) => {
        if (error !== null && error !== undefined) this.fail(error)
      })
    })
  }
  private async read(): Promise<void> {
    for await (const chunk of this.stream as AsyncIterable<Uint8Array>) {
      if (this.buffer.byteLength + chunk.byteLength > this.config.maxOutputBytes + 8)
        throw new Error('Artifact pipe exceeds the frame cap.')
      this.buffer = Buffer.concat([this.buffer, chunk])
      while (this.buffer.length >= 8) {
        const size = this.buffer.readUInt32BE(4)
        if (size > this.config.maxOutputBytes) throw new Error('Artifact pipe declares an excessive frame.')
        if (this.buffer.length < 8 + size) break
        const kind = this.buffer[0]
        if (kind !== 1)
          throw new Error(
            'Artifact renderer emitted an error or an invalid stream: ' +
              String(kind) +
              ' ' +
              this.buffer.subarray(8, 8 + Math.min(size, 512)).toString('utf8'),
          )
        this.lines = Buffer.concat([this.lines, this.buffer.subarray(8, 8 + size)])
        this.buffer = this.buffer.subarray(8 + size)
        if (this.lines.length > this.config.maxOutputBytes)
          throw new Error('Complete artifact response exceeds the output cap.')
        const newline = this.lines.indexOf(10)
        if (newline === -1) continue
        if (newline !== this.lines.length - 1)
          throw new Error('Artifact renderer emitted unsolicited messages.')
        const value = responseSchema.parse(
          JSON.parse(this.lines.subarray(0, newline).toString('utf8')) as unknown,
        )
        this.lines = Buffer.alloc(0)
        const image = Buffer.from(value.png, 'base64')
        if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value.png) || image.toString('base64') !== value.png)
          throw new Error('Artifact PNG encoding is not canonical.')
        requireStaticPng(image, this.config.width, this.config.height)
        const pending = this.pending
        if (
          pending === undefined ||
          pending.sequence !== value.sequence ||
          value.width !== this.config.width ||
          value.height !== this.config.height
        )
          throw new Error('Artifact renderer response is stale or malformed.')
        clearTimeout(pending.timer)
        this.pending = undefined
        pending.resolve({
          invocationId: this.id,
          revisionId: this.input.revision.revisionId,
          png: value.png,
          text: value.text,
          width: value.width,
          height: value.height,
        })
      }
    }
    if (!this.revoked) throw new Error('Artifact renderer ended unexpectedly.')
  }
  private fail(error: Error): void {
    const pending = this.pending
    if (pending === undefined) return
    clearTimeout(pending.timer)
    this.pending = undefined
    pending.reject(error)
  }
}
/** Accept a fixed-size static RGB/RGBA PNG; no animation or ancillary payload reaches the app decoder. */
function requireStaticPng(image: Buffer, width: number, height: number): void {
  if (
    image.byteLength < 33 ||
    image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
    image.readUInt32BE(8) !== 13 ||
    image.subarray(12, 16).toString('ascii') !== 'IHDR' ||
    image.readUInt32BE(16) !== width ||
    image.readUInt32BE(20) !== height ||
    image[24] !== 8 ||
    (image[25] !== 2 && image[25] !== 6) ||
    image[26] !== 0 ||
    image[27] !== 0 ||
    image[28] !== 0
  )
    throw new Error('Artifact PNG header disagrees with the fixed viewport format.')
  let offset = 33
  let pixels = false
  while (offset + 12 <= image.byteLength) {
    const bytes = image.readUInt32BE(offset)
    const kind = image.subarray(offset + 4, offset + 8).toString('ascii')
    offset += 12 + bytes
    if (offset > image.byteLength) throw new Error('Artifact PNG chunk exceeds its response.')
    if (kind === 'IDAT') pixels = true
    else if (kind === 'IEND' && bytes === 0 && pixels && offset === image.byteLength) return
    else throw new Error('Artifact PNG contains unsupported chunks or animation.')
  }
  throw new Error('Artifact PNG is incomplete.')
}
export default PodmanArtifactRuntime
