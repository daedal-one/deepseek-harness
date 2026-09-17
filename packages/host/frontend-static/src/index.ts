/**
 * Serves an authenticated frontend from a dist directory. The root application
 * owns the fallback seat and receives Web index injections; mounted applications
 * own a named prefix and their own bootstrap. Only explicit index entries render
 * HTML. Assets remain public, missing paths return 404, and traversal returns 403.
 * @module @deepseek-ai/dsh-host-frontend-static
 */

import type { ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
export const name = 'frontend-static'

/** Services required before an authenticated frontend can be registered. */
export const inject = ['webServer', 'connection']

/** Distribution anchor and explicit URL entry points. */
export interface Config {
  /** Absolute path of index.html inside the dist root. */
  distIndex: string
  /** Named URL prefix, or `/` for the Web shell's fallback seat and injections. */
  mountPath?: string
  /** Additional index routes relative to the mount, using ASCII path segments. */
  indexPaths?: string[]
}

// Fixed URL vocabulary excludes encoded separators, dot segments and HTML delimiters.
const ROUTE_PATH = /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/

export const Config: z<Config> = z.object({
  distIndex: z.string().required(),
  mountPath: z.string().pattern(ROUTE_PATH).default('/'),
  indexPaths: z.array(z.string().pattern(ROUTE_PATH)).default([]),
})

const HTML_MIME = 'text/html; charset=utf-8'

const MIME: Record<string, string> = {
  '.html': HTML_MIME,
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  // The packed VFS image. Served as its own bytes, never as a Content-Encoding:
  // the worker inflates the body itself, and a transport-level encoding would
  // leave it inflating an already-decoded archive.
  '.gz': 'application/gzip',
}

const STATIC_MISS_CODES: ReadonlySet<string | undefined> = new Set([
  'ENOENT',
  'EISDIR',
  'ENOTDIR',
])

/**
 * Serve one GET/HEAD static request from the dist root.
 * @param pathname - decoded URL pathname of the request.
 * @param res - the node:http response to write.
 * @param distRoot - absolute dist root directory (resolved by the caller).
 * @param distIndex - absolute path of index.html inside distRoot.
 * @param authorizeIndex - authenticates an index response before its bytes are read.
 * @param renderIndex - produces the index.html body (structured injection
 * rendering) for the dist root and configured index path.
 */
export async function serveStatic(
  pathname: string, res: ServerResponse, distRoot: string, distIndex: string,
  authorizeIndex: () => boolean,
  renderIndex: () => Promise<string>,
): Promise<void> {
  const target = resolve(normalize(join(distRoot, pathname)))
  // Traversal rejection: the target must be distRoot itself (`/`) or stay under
  // it. `sep`, not '/': resolve() emits backslash paths on Windows, where a '/'
  // suffix would reject every legitimate subpath as traversal.
  if (target !== distRoot && !target.startsWith(distRoot + sep)) {
    res.writeHead(403)
    res.end()
    return
  }
  let body: string | Buffer
  let type: string
  try {
    if (target === distRoot || target === distIndex) {
      if (!authorizeIndex()) return
      body = await renderIndex()
      type = HTML_MIME
    } else {
      body = await readFile(target)
      type = MIME[extname(target)] ?? 'application/octet-stream'
    }
  } catch (error) {
    // Only absent or non-file targets are 404; other filesystem failures reach
    // the webserver's request-failure handling.
    if (!STATIC_MISS_CODES.has((error as NodeJS.ErrnoException).code)) throw error
    res.writeHead(404)
    res.end()
    return
  }
  res.writeHead(200, {
    'content-type': type,
    'cache-control': type === HTML_MIME ? 'no-store'
      : pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  res.end(body)
}

/**
 * Register a named frontend prefix or the Web shell fallback and serve its dist.
 * @param ctx - plugin context carrying the webServer service.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const distIndex = config.distIndex
  const distRoot = dirname(distIndex)
  const mountPath = config.mountPath ?? '/'
  const indexPaths = new Set(config.indexPaths ?? [])
  const mounted = mountPath !== '/'
  const base = mounted ? `${mountPath}/` : '/'
  const renderIndex = async (): Promise<string> => {
    const raw = await readFile(distIndex, 'utf8')
    const body = mounted ? raw : ctx.webServer.renderIndex(raw)
    return body.replace(/<head(?:\s[^>]*)?>/i, open => `${open}<base href="${base}">`)
  }
  const handler: WebRoute['handler'] = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    /* v8 ignore next -- node:http always sets url on server requests */
    const rawPath = new URL(req.url ?? '/', 'http://x').pathname
    const relativePath = mounted ? rawPath.slice(mountPath.length) || '/' : rawPath
    const pathname = decodeURIComponent(relativePath)
    await serveStatic(
      indexPaths.has(pathname) ? '/' : pathname,
      res,
      distRoot,
      distIndex,
      () => ctx.connection.authorizeIndex(req, res),
      renderIndex,
    )
  }
  ctx.effect(() => mounted
    ? ctx.webServer.register({ kind: 'prefix', path: mountPath, handler })
    : ctx.webServer.registerFallback(handler), 'frontend-static: route ownership')
}
