/**
 * Podman Engine API values retained by the local-container runtime owner.
 * @module @deepseek-ai/dsh-local-container-runtime/types
 */

import type { Duplex } from 'node:stream'

/** Engine information required to prove rootless cgroup resource control. */
export interface PodmanInfo {
  /** The Engine API reports a rootless runtime. */
  Rootless?: boolean
  /** Docker-compatible cgroup version, such as `2`. */
  CgroupVersion?: string
  /** Docker-compatible cgroup manager, which must be `systemd`. */
  CgroupDriver?: string
  /** The Engine API reports memory-limit support. */
  MemoryLimit?: boolean
  /** The Engine API reports CPU CFS-quota support. */
  CPUCfsQuota?: boolean
  /** The Engine API reports PID-limit support. */
  PidsLimit?: boolean
}

/** Image metadata used to reject image-declared writable volumes. */
export interface PodmanImageInspect {
  /** Engine content identity for the inspected digest-pinned image. */
  Id?: string
  /** Image configuration, when the Engine API reports it. */
  Config?: {
    /** Image-declared mount targets. A non-empty map is rejected. */
    Volumes?: Record<string, unknown> | null
  }
}

/** One configured or engine-created mount in a container inspection response. */
export interface PodmanMountInspect {
  /** Container path receiving the mount. */
  Destination?: string
  /** Engine mount kind. */
  Type?: string
  /** Host source for a bind mount. */
  Source?: string
  /** Whether the mount is writable. */
  RW?: boolean
}

/** Container state and configuration facts used for readiness verification. */
export interface PodmanContainerInspect {
  /** Engine-assigned container id. */
  Id?: string
  /** Engine content identity of the container image. */
  Image?: string
  /** Process state. */
  State?: {
    /** Whether the container's configured entry process is running. */
    Running?: boolean
  }
  /** Container configuration. */
  Config?: {
    /** Digest-pinned image name. */
    Image?: string
    /** Explicit container user. */
    User?: string
    /** Replacement environment entries. */
    Env?: string[]
    /** Fixed container workdir. */
    WorkingDir?: string
    /** Entrypoint replacing image defaults; Podman may normalize one item to a string. */
    Entrypoint?: string | string[]
    /** Arguments supplied to the entrypoint. */
    Cmd?: string[]
  }
  /** Host-side isolation and resource settings. */
  HostConfig?: {
    /** Read-only root filesystem. */
    ReadonlyRootfs?: boolean
    /** Network namespace selection. */
    NetworkMode?: string
    /** Rootless user-namespace mapping used for the private bind. */
    UsernsMode?: string
    /** Process namespace selection. */
    PidMode?: string
    /** IPC namespace selection. */
    IpcMode?: string
    /** Whether the container is privileged. */
    Privileged?: boolean
    /** Explicit host-device mappings. */
    Devices?: unknown[]
    /** Capability drops. */
    CapDrop?: string[]
    /** Security options. */
    SecurityOpt?: string[]
    /** Container memory upper bound. */
    Memory?: number
    /** Total memory-and-swap upper bound. */
    MemorySwap?: number
    /** Container CPU upper bound in NanoCPUs. */
    NanoCpus?: number
    /** Container PID upper bound. */
    PidsLimit?: number
    /** Private tmpfs options keyed by destination. */
    Tmpfs?: Record<string, string>
    /** Bind specifications. */
    Binds?: string[]
  }
  /** Explicitly disables networking in addition to `NetworkMode: none`. */
  NetworkDisabled?: boolean
  /** User-visible configured mounts. */
  Mounts?: PodmanMountInspect[]
}

/** Docker-compatible API request for the fixed runtime container. */
export interface PodmanContainerCreate {
  /** Random owner-retained name. */
  name: string
  /** Digest-pinned runtime image. */
  Image: string
  /** Explicit runtime entrypoint. */
  Entrypoint: string[]
  /** Arguments for the explicit entrypoint. */
  Cmd: string[]
  /** Explicit non-root user. */
  User: string
  /** Fixed world directory. */
  WorkingDir: string
  /** Replacement environment; never inherited from the host process. */
  Env: string[]
  /** Read-only root filesystem. */
  ReadonlyRootfs: boolean
  /** Explicit network disablement. */
  NetworkDisabled: boolean
  /** Attach the process standard input. */
  AttachStdin?: boolean
  /** Attach the process standard output. */
  AttachStdout?: boolean
  /** Attach the process standard error. */
  AttachStderr?: boolean
  /** Keep standard input open for streaming callers. */
  OpenStdin?: boolean
  /** Close container input after the attached client disconnects. */
  StdinOnce?: boolean
  /** Allocate one terminal for all three standard streams. */
  Tty?: boolean
  /** Host restrictions and mounts. */
  HostConfig: {
    /** Private network mode selected by the deployment. */
    NetworkMode: string
    /** Preserve the invoking rootless user's numeric identity in the container. */
    UsernsMode: string
    /** Allocate a private process namespace. */
    PidMode: string
    /** Allocate a private IPC namespace. */
    IpcMode: string
    /** Never request a privileged container. */
    Privileged: false
    /** Never map host devices. */
    Devices: []
    /** Drop every Linux capability. */
    CapDrop: string[]
    /** Prevent privilege escalation. */
    SecurityOpt: string[]
    /** Bounded private `/tmp`. */
    Tmpfs: Record<string, string>
    /** The sole host bind, mounted at `/workspace`. */
    Binds: string[]
    /** Read-only image root filesystem. */
    ReadonlyRootfs: boolean
    /** Memory upper bound. */
    Memory: number
    /** Total memory-and-swap upper bound. */
    MemorySwap: number
    /** CPU upper bound. */
    NanoCpus: number
    /** PID upper bound. */
    PidsLimit: number
    /** Initial terminal dimensions as rows and columns. */
    ConsoleSize?: [number, number]
  }
}

/** One bounded stdin/stdout controller execution requested by a provider adapter. */
export interface PodmanControllerExecRequest {
  /** Owner-controlled executable and arguments. */
  readonly argv: readonly string[]
  /** Complete bytes supplied to the controller process standard input. */
  readonly stdin: Uint8Array
  /** Inclusive combined stdout and stderr byte limit. */
  readonly maxOutputBytes: number
  /** Aborts the Engine attachment request when the owner ends the operation. */
  readonly signal?: AbortSignal
}

/** Settled bounded output from one provider-controller execution. */
export interface PodmanControllerExecResult {
  /** Process exit code after standard streams settle. */
  readonly exitCode: number
  /** Complete bounded standard output bytes. */
  readonly stdout: Uint8Array
  /** Complete bounded standard error bytes. */
  readonly stderr: Uint8Array
}

/** One isolated sibling process-container request from the subprocess provider. */
export interface LocalContainerProcessRequest {
  /** Exact executable and arguments, without shell interpretation. */
  readonly argv: readonly [string, ...string[]]
  /** Canonical directory inside the execution world. */
  readonly cwd: '/workspace' | `/workspace/${string}`
  /** Explicit environment entries layered over the runtime's safe base. */
  readonly environment: Readonly<Record<string, string | undefined>>
  /** Whether to allocate one terminal and merge output streams. */
  readonly tty: boolean
  /** Whether the caller needs a writable standard-input attachment. */
  readonly stdin: boolean
  /** Initial terminal rows when `tty` is true. */
  readonly rows?: number
  /** Initial terminal columns when `tty` is true. */
  readonly cols?: number
  /** Aborts allocation before the handle commits. */
  readonly signal?: AbortSignal
}

/** One sibling container whose removal proves process-range quiescence. */
export interface LocalContainerProcessHandle {
  /** Opaque Engine id retained for diagnostics and tests. */
  readonly id: string
  /** Attached process stream; non-TTY streams use Docker multiplex framing. */
  readonly stream: Duplex
  /** Whether output is one raw terminal stream. */
  readonly tty: boolean
  /** Settled configured-process exit status. */
  readonly done: Promise<{ exitCode: number | null; error?: string }>
  /** Resize a live terminal. */
  resize(rows: number, cols: number): Promise<void>
  /** Run one bounded trusted inspection command inside this process container. */
  inspect(argv: readonly string[], maxOutputBytes: number): Promise<{ exitCode: number; output: string }>
  /** Deliver one signal to the configured entry process. */
  signal(signal: string): Promise<void>
  /** Idempotently stop and remove the complete process container. */
  terminate(): Promise<void>
  /** Guest terminal inspection when the entry process is not namespace PID 1. */
  inspectTerminalForeground?(): Promise<{ processGroupId: number; inputWaiting: boolean } | undefined>
  /** Signal the current guest foreground group without exposing a host PID. */
  signalTerminalForeground?(signal: string): Promise<number>
  /** Wait for complete container removal, optionally bounded by a caller signal. */
  waitForRemoval(signal?: AbortSignal): Promise<boolean>
}

/** One Engine API container resource owned by the runtime. */
export interface PodmanContainer {
  /** Engine-assigned opaque container id. */
  readonly id: string
  /** Read current Engine configuration and state. */
  inspect(): Promise<PodmanContainerInspect>
  /** Attach to the configured process before or after start. */
  attach(options: { stdin: boolean; stdout: boolean; stderr: boolean }): Promise<Duplex>
  /** Start the configured entry process. */
  start(): Promise<void>
  /** Wait for the configured process to stop. */
  wait(signal?: AbortSignal): Promise<{ statusCode: number; error?: string }>
  /** Resize the configured terminal. */
  resize(rows: number, cols: number): Promise<void>
  /** Deliver one signal to the configured entry process. */
  kill(signal: string): Promise<void>
  /** Stop the container and await Engine settlement. */
  stop(timeoutSeconds: number): Promise<void>
  /** Remove the container after stop or force removal. */
  remove(force: boolean): Promise<void>
  /** Run one bounded owner-controlled inspection command in the container. */
  runControl(argv: readonly string[], maxOutputBytes: number): Promise<{ exitCode: number; output: string }>
  /** Execute one bounded provider-controller command with stdin and split output. */
  runController(request: PodmanControllerExecRequest): Promise<PodmanControllerExecResult>
}

/** Minimal Docker-compatible API consumed by the owner. */
export interface PodmanEngine {
  /** Find stale containers that mount one supervisor-owned workspace.
   * @param directory - exact private host bind source.
   * @returns container handles to quiesce before restoring storage.
   */
  containersUsing(directory: string): Promise<PodmanContainer[]>

  /** Report engine capabilities before container creation. */
  info(): Promise<PodmanInfo>
  /** Read image configuration before accepting it. */
  inspectImage(image: string): Promise<PodmanImageInspect>
  /** Create the one runtime container. */
  createContainer(request: PodmanContainerCreate): Promise<PodmanContainer>
  /** Recover a lifecycle handle by the owner-retained random name. */
  getContainer(name: string): PodmanContainer
}

/** The fixed, validated configuration for one runtime owner. */
export interface LocalContainerRuntimeConfig {
  /** Offline by default; outbound uses rootless networking with host loopback disabled. */
  network?: 'none' | 'outbound'
  /** Explicit Unix socket for the rootless Podman service. */
  socketPath: string
  /** Start and own a rootless Podman API service for this DSH process. */
  manageService: boolean
  /** Absolute Podman executable used only when `manageService` is true. */
  podmanCommand?: string
  /** Maximum wait for the managed API socket to become ready. */
  serviceStartupTimeoutMs: number
  /** Digest-pinned trusted runtime image. */
  image: string
  /** Explicit non-root user that the image provides. */
  user: string
  /** Complete allowlisted replacement environment. */
  environment: Record<string, string>
  /** Hard memory limit in bytes. */
  memoryBytes: number
  /** Hard CPU limit in Docker NanoCPUs. */
  nanoCpus: number
  /** Hard PID limit. */
  pidsLimit: number
  /** Private tmpfs size in bytes. */
  tmpfsBytes: number
  /** Maximum duration of one Engine API request. */
  engineRequestTimeoutMs: number
  /** Maximum number of concurrently owned sibling process containers. */
  maxLiveProcesses: number
  /** Maximum world lifetime before automatic teardown. */
  lifetimeMs: number
  /** Engine stop timeout in whole seconds. */
  stopTimeoutSeconds: number
}

/** Deployment-authorized repository credential request; never derived from container Git configuration. */
export interface WorkspaceGitRemote {
  /** Canonical source checkout selecting this authorization. */
  source: string
  /** Exact HTTPS Git remote without embedded credentials. */
  url: string
  /** Absolute host Git credential helper; omitted for public repositories. */
  credentialCommand?: string
  /** Bound for each helper invocation. */
  credentialTimeoutMs: number
}

/** Opaque runtime container facts available to provider adapters. */
export interface LocalContainerHandle {
  /** Engine-assigned container id retained by the runtime owner. */
  readonly id: string
  /** Fixed working directory in the container namespace. */
  readonly workspacePath: '/workspace'
}

/** Diagnostic facts retained without exposing the private host backing path. */
export interface LocalContainerDiagnostics {
  /** Random owner-retained container name. */
  readonly containerName: string
  /** Engine-assigned id after creation. */
  readonly containerId: string | undefined
}

/** Optional durable data paired with supervisor-owned source checkpoint generations. */
export interface WorkspaceCheckpointRuntime {
  /** Retain development data under the source artifact's exact identity. */
  checkpoint(generation: number, checkpointHash: string): Promise<void>
  /** Remove an unpromoted generation after the prior pair has been restored. */
  discardCheckpoint?(generation: number, checkpointHash: string): Promise<void>
  /** Prune superseded data only after durable source-manifest promotion. */
  pruneCheckpoints(generation: number): Promise<void>
}

/** Execution operations consumed by conversation filesystem and subprocess adapters. */
export interface WorkspaceExecutionRuntime {
  /** Opaque world identity shared by its consumers. */
  readonly executionWorld: object
  /** Owner-generated namespace used by filesystem targets. */
  readonly containerName: string
  /** Execute a bounded controller in this world's filesystem. */
  executeController(request: PodmanControllerExecRequest & { readonly deadlineMs: number }): Promise<PodmanControllerExecResult>
  /** Allocate an attached process in this world. */
  createProcess(request: LocalContainerProcessRequest): Promise<LocalContainerProcessHandle>
  /** Establish exclusive source maintenance; reopen only after success. */
  settle<T>(
    timeoutMs: number,
    operation: (control: (
      request: PodmanControllerExecRequest & { readonly deadlineMs: number },
    ) => Promise<PodmanControllerExecResult>) => Promise<T>,
    quiesce?: () => Promise<void>,
  ): Promise<T>
  /** Stop active writers before shutdown checkpointing. */
  cancelProcesses(): Promise<void>
  /** Connect a user preview to one validated guest-loopback port. */
  connectPreview?(port: number): Promise<Duplex>
  /** Retain development data associated with a source checkpoint, if present. */
  checkpoint?: WorkspaceCheckpointRuntime['checkpoint']
  /** Remove one unpromoted development-data generation during recovery. */
  discardCheckpoint?: WorkspaceCheckpointRuntime['discardCheckpoint']
  /** Prune superseded development data only after durable source acknowledgement. */
  pruneCheckpoints?: WorkspaceCheckpointRuntime['pruneCheckpoints']
}
