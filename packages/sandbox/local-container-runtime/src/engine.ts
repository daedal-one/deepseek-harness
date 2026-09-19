/**
 * Dockerode adapter for Podman's Docker-compatible Unix-socket API.
 * @module @deepseek-ai/dsh-local-container-runtime/engine
 */

import Dockerode from 'dockerode'
import type { Duplex } from 'node:stream'
import type {
  PodmanContainer,
  PodmanContainerCreate,
  PodmanContainerInspect,
  PodmanControllerExecRequest,
  PodmanControllerExecResult,
  PodmanEngine,
  PodmanImageInspect,
  PodmanInfo,
} from './types.ts'

/** Dockerode-backed Podman API client that never falls back to a CLI or TCP host. */
export class DockerodePodmanEngine implements PodmanEngine {
  private readonly docker: Dockerode

  /**
   * Connect Dockerode to one explicit Unix socket.
   * @param socketPath - absolute rootless Podman service socket path.
   * @param timeoutMs - bounded Engine API request timeout.
   */
  constructor(socketPath: string, timeoutMs: number) {
    this.docker = new Dockerode({ socketPath, timeout: timeoutMs })
  }

  /** @returns Docker-compatible engine info used by the owner verification. */
  async info(): Promise<PodmanInfo> {
    const response: unknown = await this.docker.info()
    const info = requireObject(response, 'Engine info')
    const parsed: PodmanInfo = {}
    const rootless = optionalBoolean(info, 'Rootless')
    const cgroupVersion = optionalString(info, 'CgroupVersion')
    const cgroupDriver = optionalString(info, 'CgroupDriver')
    const memoryLimit = optionalBoolean(info, 'MemoryLimit')
    const cpuCfsQuota = optionalBoolean(info, 'CPUCfsQuota')
    const pidsLimit = optionalBoolean(info, 'PidsLimit')
    if (rootless !== undefined) parsed.Rootless = rootless
    if (cgroupVersion !== undefined) parsed.CgroupVersion = cgroupVersion
    if (cgroupDriver !== undefined) parsed.CgroupDriver = cgroupDriver
    if (memoryLimit !== undefined) parsed.MemoryLimit = memoryLimit
    if (cpuCfsQuota !== undefined) parsed.CPUCfsQuota = cpuCfsQuota
    if (pidsLimit !== undefined) parsed.PidsLimit = pidsLimit
    return parsed
  }

  /**
   * @param image - digest-pinned image accepted by the owner configuration.
   * @returns image configuration used to reject declared volumes.
   */
  async inspectImage(image: string): Promise<PodmanImageInspect> {
    const response: unknown = await this.docker.getImage(image).inspect()
    const imageInspect = requireObject(response, 'image inspection')
    const id = optionalString(imageInspect, 'Id')
    const config = requireObject(imageInspect.Config, 'image configuration')
    const volumes = config.Volumes
    if (volumes !== undefined && volumes !== null && !isRecord(volumes)) {
      throw new Error('Podman image inspection returned a non-object Volumes field')
    }
    return {
      ...id === undefined ? {} : { Id: id },
      Config: volumes === undefined ? {} : { Volumes: volumes },
    }
  }

  /**
   * @param request - fixed owner-controlled container creation request.
   * @returns Engine container lifecycle handle.
   */
  /**
   * Recover an Engine handle after an ambiguous create response.
   * @param name - owner-generated unique container name.
   * @returns a lifecycle adapter that resolves when used.
   */
  getContainer(name: string): PodmanContainer {
    return new DockerodePodmanContainer(this.docker.getContainer(name))
  }

  async createContainer(request: PodmanContainerCreate): Promise<PodmanContainer> {
    const options: Dockerode.ContainerCreateOptions = {
      Image: request.Image,
      Entrypoint: request.Entrypoint,
      Cmd: request.Cmd,
      User: request.User,
      WorkingDir: request.WorkingDir,
      Env: request.Env,
      NetworkDisabled: request.NetworkDisabled,
      HostConfig: request.HostConfig,
      ...request.AttachStdin === undefined ? {} : { AttachStdin: request.AttachStdin },
      ...request.AttachStdout === undefined ? {} : { AttachStdout: request.AttachStdout },
      ...request.AttachStderr === undefined ? {} : { AttachStderr: request.AttachStderr },
      ...request.OpenStdin === undefined ? {} : { OpenStdin: request.OpenStdin },
      ...request.StdinOnce === undefined ? {} : { StdinOnce: request.StdinOnce },
      ...request.Tty === undefined ? {} : { Tty: request.Tty },
      name: request.name,
    }
    const container = await new Promise<Dockerode.Container>((resolve, reject) => {
      this.docker.createContainer(options, (error, created) => {
        if (error !== null && error !== undefined) {
          reject(error instanceof Error ? error : new Error('dockerode createContainer failed', { cause: error }))
          return
        }
        if (created === undefined) {
          reject(new Error('dockerode did not return a created container'))
          return
        }
        resolve(created)
      })
    })
    return new DockerodePodmanContainer(container)
  }
}

/** Require one object-shaped Docker-compatible response value. */
function requireObject(value: unknown, subject: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Podman ${subject} response must be an object`)
  return value
}

/** Determine whether an API response value is a plain key-value object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read an optional boolean field without trusting Dockerode's untyped response. */
function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key]
  return typeof value === 'boolean' ? value : undefined
}

/** Read an optional string field without trusting Dockerode's untyped response. */
function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

/** Dockerode container lifecycle adapter. */
class DockerodePodmanContainer implements PodmanContainer {
  /** Engine-assigned id retained by the runtime owner. */
  readonly id: string

  constructor(private readonly container: Dockerode.Container) {
    this.id = container.id
  }

  /** @returns Docker-compatible container inspection facts. */
  async inspect(): Promise<PodmanContainerInspect> {
    return await this.container.inspect() as unknown as PodmanContainerInspect
  }

  /** Attach to the configured process streams. */
  async attach(options: { stdin: boolean; stdout: boolean; stderr: boolean }): Promise<Duplex> {
    return await this.container.attach({
      stream: true,
      hijack: true,
      logs: false,
      stdin: options.stdin,
      stdout: options.stdout,
      stderr: options.stderr,
    }) as unknown as Duplex
  }

  /** Start the configured runtime process. */
  async start(): Promise<void> {
    await this.container.start()
  }

  /** Wait for the configured process to stop. */
  async wait(signal?: AbortSignal): Promise<{ statusCode: number; error?: string }> {
    const options = signal === undefined ? { condition: 'not-running' as const } : { condition: 'not-running' as const, abortSignal: signal }
    const value = await this.container.wait(options) as unknown
    if (!isRecord(value) || typeof value.StatusCode !== 'number') {
      throw new Error('local-container-runtime: Engine wait response omitted the process status')
    }
    const errorValue = value.Error
    const message = isRecord(errorValue) && typeof errorValue.Message === 'string' && errorValue.Message.length > 0
      ? errorValue.Message : undefined
    return { statusCode: value.StatusCode, ...message === undefined ? {} : { error: message } }
  }

  /** Resize the configured terminal. */
  async resize(rows: number, cols: number): Promise<void> {
    await this.container.resize({ h: rows, w: cols })
  }

  /** Deliver one signal to the configured entry process. */
  async kill(signal: string): Promise<void> {
    await this.container.kill({ signal })
  }

  /**
   * @param timeoutSeconds - bounded graceful stop window accepted by the Engine API.
   */
  async stop(timeoutSeconds: number): Promise<void> {
    await this.container.stop({ t: timeoutSeconds })
  }

  /**
   * @param force - whether the Engine must remove a still-running container.
   */
  async remove(force: boolean): Promise<void> {
    await this.container.remove({ force, v: false })
  }

  /**
   * Run one owner-controlled inspection command with a complete output bound.
   * @param argv - fixed command and arguments chosen by the runtime owner.
   * @param maxOutputBytes - maximum combined response bytes accepted from the command.
   * @returns the settled exit code and UTF-8 output.
   */
  async runControl(argv: readonly string[], maxOutputBytes: number): Promise<{ exitCode: number; output: string }> {
    const exec = await this.container.exec({
      Cmd: [...argv],
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
    })
    const stream = await exec.start({ hijack: true, stdin: false })
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
      bytes += buffer.byteLength
      if (bytes > maxOutputBytes) {
        stream.destroy()
        throw new Error(`local-container-runtime: control response exceeded ${maxOutputBytes} bytes`)
      }
      chunks.push(buffer)
    }
    const inspection = await exec.inspect()
    if (typeof inspection.ExitCode !== 'number') {
      throw new Error('local-container-runtime: control command settled without an exit code')
    }
    return { exitCode: inspection.ExitCode, output: Buffer.concat(chunks).toString('utf8') }
  }

  /** Execute a provider-owned controller command through the multiplexed Engine stream. */
  async runController(request: PodmanControllerExecRequest): Promise<PodmanControllerExecResult> {
    const exec = await this.container.exec({
      Cmd: [...request.argv],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    })
    const startOptions = request.signal === undefined
      ? { hijack: true, stdin: true }
      : { hijack: true, stdin: true, abortSignal: request.signal }
    const stream = await new Promise<Duplex>((resolve, reject) => {
      exec.start(startOptions, (error, started) => {
        if (error !== null && error !== undefined) {
          reject(error instanceof Error ? error : new Error('dockerode exec start failed', { cause: error }))
          return
        }
        if (started === undefined) {
          reject(new Error('dockerode exec start did not return a stream'))
          return
        }
        resolve(started)
      })
    })
    const onAbort = (): void => { stream.destroy() }
    request.signal?.addEventListener('abort', onAbort, { once: true })
    const stdout: Array<Buffer> = []
    const stderr: Array<Buffer> = []
    let buffered: Buffer = Buffer.from([])
    let bytes = 0
    try {
      stream.end(Buffer.from(request.stdin))
      for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
        const next = Buffer.from(chunk)
        buffered = buffered.length === 0 ? next : Buffer.concat([buffered, next])
        while (buffered.length >= 8) {
          const streamType = buffered[0]
          const payloadBytes = buffered.readUInt32BE(4)
          if (payloadBytes > request.maxOutputBytes - bytes) {
            stream.destroy()
            throw new Error(`local-container-runtime: controller response exceeded ${request.maxOutputBytes} bytes`)
          }
          if (buffered.length < payloadBytes + 8) break
          const payload = buffered.subarray(8, payloadBytes + 8)
          bytes += payloadBytes
          if (streamType === 1) stdout.push(payload)
          else if (streamType === 2) stderr.push(payload)
          else throw new Error('local-container-runtime: controller response used an unknown stream type')
          buffered = buffered.subarray(payloadBytes + 8)
        }
      }
      if (buffered.length !== 0) throw new Error('local-container-runtime: controller response ended with a partial frame')
      const inspection = await exec.inspect()
      if (typeof inspection.ExitCode !== 'number') {
        throw new Error('local-container-runtime: controller command settled without an exit code')
      }
      return {
        exitCode: inspection.ExitCode,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      }
    } finally {
      request.signal?.removeEventListener('abort', onAbort)
    }
  }
}
