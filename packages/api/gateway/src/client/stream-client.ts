/** Shared owner for the Gateway multiplexed Remote stream socket. */
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

import {
  parseRemoteStreamServerMessage,
  type RemoteStreamClientMessage,
  type RemoteStreamServerMessage,
} from '../stream-protocol.ts'
import { Deque } from '@deepseek-ai/dsh-deque'

const SOCKET_OPEN = 1

/** Socket operations required by the multiplexed stream carrier. */
export interface RemoteStreamSocket {
  readonly readyState: number
  /** @param data - one encoded client frame. */
  send(data: string): void
  /**
   * @param code - protocol close code.
   * @param reason - close description.
   */
  close(code?: number, reason?: string): void
  /**
   * @param type - lifecycle event.
   * @param listener - callback.
   * @param options - once-only delivery.
   */
  addEventListener(type: 'open' | 'error' | 'close', listener: () => void, options?: { once?: boolean }): void
  /**
   * @param type - message event.
   * @param listener - incoming frame callback.
   */
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void
  /**
   * @param type - lifecycle event.
   * @param listener - registered callback.
   */
  removeEventListener(type: 'open' | 'error' | 'close', listener: () => void): void
  /**
   * @param type - message event.
   * @param listener - registered callback.
   */
  removeEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void
}

/** Cancellation subset supported by browser and native platform signals. */
export interface RemoteStreamSignal {
  readonly aborted: boolean
  readonly reason?: unknown
  /**
   * @param type - abort event.
   * @param listener - cancellation callback.
   * @param options - once-only delivery.
   */
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void
  /**
   * @param type - abort event.
   * @param listener - registered callback.
   */
  removeEventListener(type: 'abort', listener: () => void): void
}

/** Physical socket and correlation identity supplied by the transport owner. */
export interface RemoteStreamTransport {
  /** @returns a fresh socket for one physical connection attempt. */
  createSocket(): RemoteStreamSocket
  /** @returns a new wire identity for each logical stream, including after reconnect. */
  randomId(): string
}

/** Physical Remote stream socket failure that may be retried by a domain transport. */
export class RemoteStreamCarrierError extends Error {
  /**
   * @param message - physical carrier failure description.
   * @param options - optional causal error.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RemoteStreamCarrierError'
  }
}

interface SocketWaiter {
  readonly revision: number
  resolve(socket: RemoteStreamSocket): void
  reject(error: unknown): void
}

/** Keep one physical WebSocket and share it among independently cancellable Remote streams. */
export class RemoteStreamMuxClient {
  private socket: RemoteStreamSocket | undefined
  private cancelCandidate: ((error: Error) => void) | undefined
  private keepAlive: Promise<void> | undefined
  private revision = 0
  private readonly streams = new Map<string, StreamInbox>()
  private readonly waiters = new Set<SocketWaiter>()
  private running = false
  private disposed = false

  /** @param transport - per-owner socket creation and logical stream identity. */
  constructor(private readonly transport: RemoteStreamTransport) {}

  /** Ensure a physical attempt exists, following the current attempt once if needed. */
  start(): void {
    if (this.disposed) return
    this.running = true
    if (this.socket?.readyState === SOCKET_OPEN) return
    const pending = this.keepAlive
    if (pending === undefined) this.maintain()
    else void pending.then(() => { this.maintain() })
  }

  /** Cancel the current socket or retry wait and start a fresh attempt immediately. */
  reconnect(): void {
    if (!this.running || this.disposed) return
    const failure = new RemoteStreamCarrierError('api gateway: Remote stream reconnect requested')
    const pending = this.keepAlive
    this.revision++
    this.cancelCandidate?.(failure)
    const socket = this.socket
    if (socket !== undefined) {
      this.socket = undefined
      this.failAll(failure)
      socket.close(4000, 'reconnect requested')
    }
    if (pending === undefined) this.maintain()
    else void pending.then(() => { this.maintain() })
  }

  /**
   * Open one logical stream on the persistent physical connection.
   * If no physical attempt is active, opening waits for Connection to request
   * one or for the signal to abort.
   * @param endpoint - Typert Remote stream endpoint.
   * @param payload - endpoint request encoded on the wire.
   * @param signal - cancellation for this logical stream.
   * @returns Host items until completion, cancellation, or failure.
   */
  async *open(
    endpoint: string,
    payload: unknown,
    signal: RemoteStreamSignal,
  ): AsyncGenerator {
    throwIfAborted(signal)
    const streamId = this.transport.randomId()
    const inbox = new StreamInbox()
    let carrier: RemoteStreamSocket | undefined
    let opened = false
    let terminal = false
    const abort = (): void => { inbox.fail(abortReason(signal)) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      const socket = await this.waitForSocket(signal)
      throwIfAborted(signal)
      carrier = socket
      this.streams.set(streamId, inbox)
      this.send(socket, { type: 'open', streamId, endpoint, payload })
      opened = true
      while (true) {
        const frame = await inbox.next()
        throwIfAborted(signal)
        if (frame.type === 'item') {
          yield frame.value
          continue
        }
        terminal = true
        if (frame.type === 'error') {
          throw new RemoteError(frame.error.code as never, frame.error.message, frame.error.details as never)
        }
        return
      }
    } finally {
      signal.removeEventListener('abort', abort)
      this.streams.delete(streamId)
      if (opened && !terminal && carrier?.readyState === SOCKET_OPEN) {
        this.send(carrier, { type: 'cancel', streamId })
      }
    }
  }

  /**
   * Permanently stop the carrier, close the physical socket, and fail every
   * active logical stream.
   * @returns once the active connection attempt has stopped.
   */
  async close(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true
      this.running = false
      const error = new Error('api gateway: Remote stream client disposed')
      this.failAll(error)
      for (const waiter of [...this.waiters]) waiter.reject(error)
      this.cancelCandidate?.(error)
      const socket = this.socket
      this.socket = undefined
      socket?.close(1000, 'disposed')
    }
    await this.keepAlive
  }

  private connect(): Promise<RemoteStreamSocket> {
    const socket = this.transport.createSocket()
    const connecting = new Promise<RemoteStreamSocket>((resolve, reject) => {
      let settled = false
      const rejectCandidate = (error: Error): void => {
        settled = true
        socket.removeEventListener('open', opened)
        socket.removeEventListener('error', failed)
        socket.removeEventListener('message', received)
        socket.removeEventListener('close', closed)
        this.cancelCandidate = undefined
        socket.close()
        reject(error)
      }
      const opened = (): void => {
        settled = true
        this.cancelCandidate = undefined
        this.socket = socket
        for (const waiter of [...this.waiters]) waiter.resolve(socket)
        resolve(socket)
      }
      const failed = (): void => {
        if (!settled) {
          rejectCandidate(new RemoteStreamCarrierError(
            'api gateway: Remote stream WebSocket failed to open',
          ))
          return
        }
        const error = new RemoteStreamCarrierError('api gateway: Remote stream WebSocket failed')
        this.lost(socket, error)
        socket.close()
      }
      const closed = (): void => {
        if (!settled) {
          rejectCandidate(new RemoteStreamCarrierError(
            'api gateway: Remote stream WebSocket closed before opening',
          ))
          return
        }
        this.lost(socket)
      }
      const received = (event: { readonly data: unknown }): void => { this.receive(socket, event.data) }
      this.cancelCandidate = rejectCandidate
      socket.addEventListener('open', opened, { once: true })
      socket.addEventListener('error', failed, { once: true })
      socket.addEventListener('message', received)
      socket.addEventListener('close', closed, { once: true })
    })
    return connecting
  }

  private waitForSocket(signal: RemoteStreamSignal): Promise<RemoteStreamSocket> {
    throwIfAborted(signal)
    if (this.socket?.readyState === SOCKET_OPEN) return Promise.resolve(this.socket)
    if (this.disposed) return Promise.reject(new Error('api gateway: Remote stream client disposed'))
    if (!this.running) return Promise.reject(new Error('api gateway: Remote stream client not started'))
    return new Promise((resolve, reject) => {
      const aborted = (): void => { waiter.reject(abortReason(signal)) }
      const cleanup = (): void => {
        this.waiters.delete(waiter)
        signal.removeEventListener('abort', aborted)
      }
      const waiter: SocketWaiter = {
        revision: this.revision,
        resolve: (socket) => {
          cleanup()
          resolve(socket)
        },
        reject: (error) => {
          cleanup()
          // AbortSignal.reason belongs to the caller and may intentionally be a non-Error sentinel.
          // oxlint-disable-next-line typescript/prefer-promise-reject-errors
          reject(error)
        },
      }
      this.waiters.add(waiter)
      signal.addEventListener('abort', aborted, { once: true })
    })
  }

  private receive(socket: RemoteStreamSocket, data: unknown): void {
    if (socket !== this.socket) return
    try {
      if (typeof data !== 'string') throw new Error('api gateway: Remote stream WebSocket requires text messages')
      const frame = parseRemoteStreamServerMessage(data)
      this.streams.get(frame.streamId)?.push(frame)
    } catch (error) {
      const failure = new RemoteStreamCarrierError('api gateway: invalid Remote stream frame', { cause: error })
      this.failAll(failure)
      this.lost(socket, failure)
      socket.close(4002, 'invalid Remote stream frame')
    }
  }

  private lost(
    socket: RemoteStreamSocket,
    error: RemoteStreamCarrierError = new RemoteStreamCarrierError(
      'api gateway: Remote stream WebSocket closed',
    ),
  ): void {
    if (this.socket !== socket) return
    this.socket = undefined
    this.failAll(error)
  }

  private maintain(): void {
    if (!this.running || this.disposed) return
    if (this.socket?.readyState === SOCKET_OPEN || this.keepAlive !== undefined) return
    const revision = this.revision
    const task = this.connect().then(
      () => undefined,
      (error: unknown) => {
        if (!this.running) return
        for (const waiter of [...this.waiters]) {
          if (waiter.revision <= revision) waiter.reject(error)
        }
      },
    )
    this.keepAlive = task
    void task.then(() => {
      this.keepAlive = undefined
    })
  }

  private failAll(error: unknown): void {
    for (const stream of this.streams.values()) stream.fail(error)
  }

  private send(socket: RemoteStreamSocket, message: RemoteStreamClientMessage): void {
    socket.send(JSON.stringify(message))
  }
}

class StreamInbox {
  private readonly frames = new Deque<RemoteStreamServerMessage>()
  private wake: (() => void) | undefined
  private failure: Error | undefined

  push(frame: RemoteStreamServerMessage): void {
    if (this.failure !== undefined) return
    this.frames.pushBack(frame)
    this.wake?.()
    this.wake = undefined
  }

  fail(error: unknown): void {
    if (this.failure !== undefined) return
    this.failure = error instanceof Error ? error : new Error(String(error), { cause: error })
    this.frames.clear()
    this.wake?.()
    this.wake = undefined
  }

  async next(): Promise<RemoteStreamServerMessage> {
    while (this.frames.size === 0) {
      if (this.failure !== undefined) throw this.failure
      await new Promise<void>((resolve) => { this.wake = resolve })
    }
    return this.frames.popFront() as RemoteStreamServerMessage
  }
}

function abortReason(signal: RemoteStreamSignal): unknown {
  if ('reason' in signal) return signal.reason
  const error = new Error('api gateway: Remote stream aborted')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal: RemoteStreamSignal): void {
  // A signal may intentionally carry a non-Error reason.
  if (signal.aborted) throw abortReason(signal)
}
