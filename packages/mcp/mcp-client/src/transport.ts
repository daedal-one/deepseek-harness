/**
 * Transport factory: creates the appropriate MCP transport based on the
 * plugin's resolved config. Stdio spawns a child process (with credential
 * scrubbing); Streamable HTTP connects to a URL.
 *
 * @module
 */

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { Config } from './index.ts'

/** MCP stdio transport backed by the harness's managed process-tree seam. */
class ManagedStdioTransport implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  private readonly readBuffer = new ReadBuffer()
  private handle: SubprocessHandle | undefined
  private started = false
  private closed = false

  constructor(
    private readonly subprocess: SubprocessRuntime,
    private readonly config: Extract<Config, { transport: 'stdio' }>,
  ) {}

  /** Resolve and spawn the configured server through the managed subprocess provider. */
  async start(): Promise<void> {
    if (this.started) throw new Error('managed MCP stdio transport was already started')
    this.started = true
    const executable = await this.subprocess.resolveExecutable(this.config.command, this.config.env)
    const handle = this.subprocess.spawn({
      argv: [executable, ...this.config.args],
      cwd: this.config.cwd === '' ? process.cwd() : this.config.cwd,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
      graceMs: this.config.processGraceMs,
      env: this.config.env,
    })
    this.handle = handle
    handle.stdout?.on('data', (chunk: Buffer | string) => {
      this.readBuffer.append(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      this.processReadBuffer()
    })
    handle.stdout?.on('error', (error: Error) => { this.onerror?.(error) })
    handle.stdin?.on('error', (error: Error) => { this.onerror?.(error) })
    void handle.done.then(
      () => { this.finishClose() },
      (error: unknown) => {
        const failure = error instanceof Error ? error : new Error(String(error))
        this.onerror?.(failure)
        this.finishClose()
      },
    )
    // Providers publish `pid = -1` only for an asynchronously reported spawn failure.
    if (handle.pid === -1) await handle.done
  }

  /** Serialize one protocol message to the managed stdin stream. */
  async send(message: JSONRPCMessage): Promise<void> {
    const stdin = this.handle?.stdin
    if (stdin === undefined) throw new Error('managed MCP stdio transport is not connected')
    const serialized = serializeMessage(message)
    if (stdin.write(serialized)) return
    await new Promise<void>((resolve, reject) => {
      const onDrain = (): void => { cleanup(); resolve() }
      const onError = (error: Error): void => { cleanup(); reject(error) }
      const cleanup = (): void => {
        stdin.off('drain', onDrain)
        stdin.off('error', onError)
      }
      stdin.once('drain', onDrain)
      stdin.once('error', onError)
    })
  }

  /** Terminate the complete server process tree and await quiescence. */
  async close(): Promise<void> {
    const handle = this.handle
    if (handle === undefined) {
      this.finishClose()
      return
    }
    this.handle = undefined
    handle.terminate()
    await handle.waitForExit()
    this.finishClose()
  }

  /** Drain complete newline-framed JSON-RPC messages. */
  private processReadBuffer(): void {
    while (true) {
      try {
        const message = this.readBuffer.readMessage()
        if (message === null) return
        this.onmessage?.(message)
      } catch (error: unknown) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  /** Publish the transport close edge once. */
  private finishClose(): void {
    if (this.closed) return
    this.closed = true
    this.handle = undefined
    this.readBuffer.clear()
    this.onclose?.()
  }
}

/**
 * Create an MCP transport from the resolved plugin config.
 *
 * @param ctx - plugin context used to resolve the managed subprocess provider.
 * @param config - Resolved plugin config discriminated on `transport`.
 * @returns A connected-ready MCP Transport (stdio or Streamable HTTP).
 */
export function createTransport(ctx: Context, config: Config): Transport {
  switch (config.transport) {
    case 'stdio': {
      const subprocess = ctx.get('subprocess')
      if (subprocess === undefined) {
        throw new Error(`mcp-client(${config.serverName}): stdio transport requires the subprocess service`)
      }
      return new ManagedStdioTransport(subprocess, config)
    }
    case 'streamable-http':
      // The MCP SDK's StreamableHTTPClientTransport has optional callback
      // properties typed without `| undefined` (exactOptionalPropertyTypes
      // mismatch with the Transport interface); the SDK constructed the
      // object, so the cast records only that widening.
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        { requestInit: { headers: config.headers } },
      ) as Transport
  }
}
