/**
 * @deepseek-ai/dsh-host-webserver — Web route-registration plugin: a node:http
 * server plus the `webServer` service (HTTP and upgrade route registries,
 * index transform taps, and the single fallback seat for everything no route
 * claims). Knows no harness concepts and serves no files; the composing
 * application's frontend plugin owns dist serving through the fallback hook.
 * Web shape only — Electron loads dist over file:// and carries fetch over an
 * IPC bridge. This package never prints: the URL line belongs to the shell.
 */

import { createServer } from 'node:http'
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { promisify } from 'node:util'
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

const compressBrotli = promisify(brotliCompress)
const compressGzip = promisify(gzip)
const MIN_COMPRESS_BYTES = 1_024
const DEFAULT_BROTLI_QUALITY = 9
const DEFAULT_GZIP_LEVEL = 6

interface CompressionOptions {
  brotliQuality: number
  gzipLevel: number
}

/** Headers accepted by {@link sendBuffer}. */
export type BufferResponseHeaders = OutgoingHttpHeaders

function acceptsEncoding(header: string | undefined, encoding: 'br' | 'gzip'): boolean {
  if (header === undefined) return false
  const values = new Map(header.split(',').map((part) => {
    const [name = '', ...params] = part.trim().split(';')
    const q = params.map(value => value.trim()).find(value => value.startsWith('q='))
    return [name.toLowerCase(), q === undefined ? 1 : Number(q.slice(2))] as const
  }))
  return (values.get(encoding) ?? values.get('*') ?? 0) > 0
}

function isCompressible(contentType: string | undefined): boolean {
  if (contentType === undefined) return false
  return /^(?:text\/|application\/(?:javascript|json|manifest\+json|xml)|image\/svg\+xml)/i.test(contentType)
}

/**
 * Write a complete HTTP body with deterministic content negotiation. Brotli
 * wins over gzip, tiny and incompressible bodies stay unchanged, and HEAD
 * receives the headers of the selected representation without a body.
 * @param req - incoming request carrying Accept-Encoding and the method.
 * @param res - response owned by the caller.
 * @param status - HTTP status.
 * @param headers - response headers before representation negotiation.
 * @param body - complete response bytes.
 * @param compression - deployment compression levels.
 * @returns when the selected representation has been written.
 */
export async function sendBuffer(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  headers: BufferResponseHeaders,
  body: string | Buffer,
  compression: CompressionOptions = {
    brotliQuality: DEFAULT_BROTLI_QUALITY,
    gzipLevel: DEFAULT_GZIP_LEVEL,
  },
): Promise<void> {
  const source = Buffer.isBuffer(body) ? body : Buffer.from(body)
  const normalized: OutgoingHttpHeaders = { ...headers }
  const contentTypeHeader = Object.entries(normalized).find(([name]) => name.toLowerCase() === 'content-type')?.[1]
  const contentType = typeof contentTypeHeader === 'string' ? contentTypeHeader : undefined
  const alreadyEncoded = Object.keys(normalized).some(name => name.toLowerCase() === 'content-encoding')
  let payload = source
  if (!alreadyEncoded && source.byteLength >= MIN_COMPRESS_BYTES && isCompressible(contentType ?? '')) {
    const accept = req.headers['accept-encoding']
    if (acceptsEncoding(accept, 'br')) {
      payload = await compressBrotli(source, {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: compression.brotliQuality },
      })
      normalized['content-encoding'] = 'br'
    } else if (acceptsEncoding(accept, 'gzip')) {
      payload = await compressGzip(source, { level: compression.gzipLevel })
      normalized['content-encoding'] = 'gzip'
    }
    normalized.vary = normalized.vary === undefined ? 'Accept-Encoding' : `${normalized.vary}, Accept-Encoding`
  }
  normalized['content-length'] = payload.byteLength
  res.writeHead(status, normalized)
  res.end(req.method === 'HEAD' ? undefined : payload)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: WebServer
  }
}

/** Route match kind: 'exact' matches the pathname verbatim; 'prefix' p matches p and p/<anything>. */
export type WebRouteKind = 'exact' | 'prefix'

/** One named route registration. */
export interface WebRoute {
  kind: WebRouteKind
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns the full response lifecycle (may hold the response open, e.g. SSE). */
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** One exact-path HTTP upgrade registration. */
export interface WebUpgradeRoute {
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns protocol negotiation and the upgraded socket after dispatch. */
  handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
}

/** Gateway config: the listen address. */
export interface Config {
  /** Listen host; the two supported values are loopback and all-interfaces. */
  host: '127.0.0.1' | '0.0.0.0'
  /** Listen port; zero requests an OS-assigned port. */
  port: number
  /** Brotli quality for complete compressible responses. @default 9 */
  brotliQuality?: number
  /** gzip level for complete compressible responses. @default 6 */
  gzipLevel?: number
}

/**
 * The browser HTTP carrier service. Activation listens immediately. Route
 * registration order does not affect requests because configured named routes
 * must be distinct, and the fallback handler answers anything not yet claimed
 * during startup with 404 until its owner registers. A listen failure rejects
 * initialization, and the boot process reports the failed fiber.
 */
export class WebServer extends Service {
  static Config: z<Config> = z.object({
    host: z.union([z.const('127.0.0.1'), z.const('0.0.0.0')]).required(),
    port: z.natural().max(65535).required(),
    brotliQuality: z.natural().max(11).default(DEFAULT_BROTLI_QUALITY),
    gzipLevel: z.natural().max(9).default(DEFAULT_GZIP_LEVEL),
  })

  private readonly exact = new Map<string, WebRoute>()
  private readonly prefixes = new Map<string, WebRoute>()
  private readonly upgrades = new Map<string, WebUpgradeRoute>()
  private readonly upgradedSockets = new Set<Duplex>()
  private readonly indexTaps: ((html: string) => string)[] = []
  private fallback: WebRoute['handler'] | undefined
  private server!: Server
  private listenedPort!: number

  constructor(ctx: Context, private config: Config) {
    super(ctx, 'webServer')
  }

  /** The listening port (the OS-assigned value when config.port is 0). */
  get port(): number {
    return this.listenedPort
  }

  /** The configured bind host (the loopback or all-interfaces literal). */
  get host(): Config['host'] {
    return this.config.host
  }

  /**
   * Write one complete response using this deployment's compression policy.
   * @param req - incoming request carrying representation preferences.
   * @param res - response owned by the caller.
   * @param status - HTTP status.
   * @param headers - response headers before representation negotiation.
   * @param body - complete response bytes.
   * @returns when the selected representation has been written.
   */
  sendBuffer(
    req: IncomingMessage,
    res: ServerResponse,
    status: number,
    headers: BufferResponseHeaders,
    body: string | Buffer,
  ): Promise<void> {
    return sendBuffer(req, res, status, headers, body, {
      brotliQuality: this.config.brotliQuality ?? DEFAULT_BROTLI_QUALITY,
      gzipLevel: this.config.gzipLevel ?? DEFAULT_GZIP_LEVEL,
    })
  }

  /**
   * Register a named route. Duplicate (kind, path) throws — route patterns are
   * a composition-level contract, so a collision is a misconfiguration.
   * @param route - kind, path, and the owning handler.
   * @returns the disposer removing the route.
   */
  register(route: WebRoute): () => void {
    const table = route.kind === 'exact' ? this.exact : this.prefixes
    if (table.has(route.path)) {
      throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
    }
    table.set(route.path, route)
    return () => { table.delete(route.path) }
  }

  /**
   * Register an exact-path HTTP upgrade route. Duplicate paths throw because
   * one socket can have only one protocol owner.
   * @param route - pathname and handler owning negotiation plus socket use.
   * @returns the disposer removing the route.
   */
  registerUpgrade(route: WebUpgradeRoute): () => void {
    if (this.upgrades.has(route.path)) {
      throw new Error(`webserver: duplicate upgrade route "${route.path}"`)
    }
    this.upgrades.set(route.path, route)
    return () => { this.upgrades.delete(route.path) }
  }

  /**
   * Claim the fallback seat: the handler answering every request no named
   * route matches (the SPA dist server in the shipped Web composition). One
   * owner only — a second registration throws, because two fallbacks cannot
   * compose.
   * @param handler - owns the full response lifecycle of unmatched requests.
   * @returns the disposer releasing the seat.
   */
  registerFallback(handler: WebRoute['handler']): () => void {
    if (this.fallback !== undefined) {
      throw new Error('webserver: fallback already registered')
    }
    this.fallback = handler
    return () => { this.fallback = undefined }
  }

  /**
   * Register an index.html transform, applied by the fallback owner to every
   * index response ({@link applyIndexTaps}) in registration order.
   * @param transform - pure html-to-html function.
   * @returns the disposer removing the transform.
   */
  tapIndex(transform: (html: string) => string): () => void {
    this.indexTaps.push(transform)
    return () => {
      const at = this.indexTaps.indexOf(transform)
      if (at !== -1) this.indexTaps.splice(at, 1)
    }
  }

  /** Listen; resolves once the socket is bound (rejection = FAILED fiber). */
  async [Service.init](): Promise<void> {
    const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      /* v8 ignore next -- `?? '/'` arm: node:http always sets url on server
      requests; the field is only optional on the client-side IncomingMessage type */
      const rawPath = new URL(req.url ?? '/', 'http://x').pathname
      const route = this.match(rawPath)
      if (route !== undefined) {
        await route.handler(req, res)
        return
      }
      const fallback = this.fallback
      if (fallback === undefined) {
        res.writeHead(404)
        res.end()
        return
      }
      await fallback(req, res)
    }
    // Last-resort guard: handle() rejecting would otherwise be an unhandled
    // rejection killing the process on one malformed request (bad %-escape,
    // client dropping mid-body). Per-request failures log and answer 400 —
    // never a process exit.
    this.server = createServer((req, res) => {
      handle(req, res).catch((err: unknown) => {
        this.ctx.logger.warn(err instanceof Error ? err : new Error(String(err)))
        if (res.headersSent) {
          res.destroy()
          return
        }
        res.writeHead(400)
        res.end()
      })
    })
    this.server.on('upgrade', (req, socket, head) => {
      const onError = (error: Error): void => {
        this.ctx.logger.warn(error)
        socket.destroy()
      }
      socket.on('error', onError)
      socket.once('close', () => {
        socket.off('error', onError)
        this.upgradedSockets.delete(socket)
      })
      let route: WebUpgradeRoute | undefined
      try {
        /* v8 ignore next -- node:http always sets url on server requests. */
        route = this.upgrades.get(new URL(req.url ?? '/', 'http://x').pathname)
      } catch (error) {
        this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        socket.destroy()
        return
      }
      if (route === undefined) {
        socket.destroy()
        return
      }
      this.upgradedSockets.add(socket)
      try {
        Promise.resolve(route.handler(req, socket, head)).catch((error: unknown) => {
          this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
          socket.destroy()
        })
      } catch (error) {
        this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        socket.destroy()
      }
    })

    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.config.port, this.config.host, () => {
        this.server.off('error', reject)
        this.server.on('error', (err) => { this.ctx.logger.error(err) })
        this.listenedPort = (this.server.address() as AddressInfo).port
        resolve()
      })
    })

    // Node does not include upgraded sockets in closeAllConnections(). The service
    // owns them with the other connections, so it tracks and destroys them explicitly.
    this.ctx.effect(() => async () => {
      const serverClosed = new Promise<void>((resolve) => {
        this.server.close(() => { resolve() })
      })
      this.server.closeAllConnections()
      const upgradedClosed = [...this.upgradedSockets].map(socket => new Promise<void>((resolve) => {
        socket.once('close', () => { resolve() })
        socket.destroy()
      }))
      await Promise.all([serverClosed, ...upgradedClosed])
    }, 'webServer.listen')
  }

  /** Longest-prefix-wins over the prefix table after an exact-table miss. */
  private match(pathname: string): WebRoute | undefined {
    const exact = this.exact.get(pathname)
    if (exact !== undefined) return exact
    let best: WebRoute | undefined
    for (const [prefix, route] of this.prefixes) {
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue
      if (best === undefined || prefix.length > best.path.length) best = route
    }
    return best
  }

  /**
   * Run an index.html body through the registered taps in registration order
   * — called by the fallback owner on every index response it renders.
   * @param html - the raw index.html body.
   * @returns the transformed body.
   */
  applyIndexTaps(html: string): string {
    let out = html
    for (const transform of this.indexTaps) out = transform(out)
    return out
  }
}

export default WebServer
