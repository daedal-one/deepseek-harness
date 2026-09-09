/** Loopback-only Git smart HTTP fixture; every credential and repository is synthetic. */
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'

export async function gitHttpFixture(root: string, source: string) {
  const repositories = join(root, 'remote')
  const bare = join(repositories, 'apps/atlas.git')
  await mkdir(join(repositories, 'apps'), { recursive: true })
  await promisify(execFile)('git', ['clone', '--bare', '--no-hardlinks', source, bare])
  let requests = 0
  let delay = 0
  const children = new Set<ReturnType<typeof spawn>>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const server = createServer((req, res) => {
    requests++
    const target = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.headers.authorization !== 'token synthetic-forgejo-token') { res.writeHead(401); res.end(); return }
    if (!/^\/apps\/atlas\.git\/(?:info\/refs|git-upload-pack)$/.test(target.pathname)) { res.writeHead(404); res.end(); return }
    const start = () => {
      if (res.destroyed) return
      const child = spawn('git', ['http-backend'], { env: {
        PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_PROJECT_ROOT: repositories, GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: target.pathname, QUERY_STRING: target.search.slice(1), REQUEST_METHOD: req.method,
        CONTENT_TYPE: req.headers['content-type'], REMOTE_ADDR: '127.0.0.1',
      }, stdio: ['pipe', 'pipe', 'ignore'] })
      children.add(child)
      child.stdin.on('error', () => {})
      req.pipe(child.stdin)
      let pending = Buffer.alloc(0)
      let headers = false
      child.stdout.on('data', (chunk: Buffer) => {
        if (headers) { res.write(chunk); return }
        pending = Buffer.concat([pending, chunk])
        const split = pending.indexOf('\r\n\r\n')
        if (split < 0) { assert(pending.length < 64 * 1024); return }
        const values: Record<string, string> = {}
        let status = 200
        for (const line of pending.subarray(0, split).toString().split('\r\n')) {
          const separator = line.indexOf(':')
          const name = line.slice(0, separator).toLowerCase()
          const value = line.slice(separator + 1).trim()
          if (name === 'status') status = Number(value.split(' ')[0]); else values[name] = value
        }
        res.writeHead(status, values)
        headers = true
        res.write(pending.subarray(split + 4))
      })
      child.once('error', () => { res.writeHead(500); res.end() })
      child.once('close', () => { children.delete(child); res.end() })
      res.once('close', () => { child.kill() })
    }
    if (delay) { const timer = setTimeout(() => { timers.delete(timer); start() }, delay); timers.add(timer) } else start()
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  assert(address && typeof address !== 'string')
  return {
    origin: `http://127.0.0.1:${String(address.port)}`, bare,
    requestCount: () => requests,
    delay: (milliseconds: number) => { delay = milliseconds },
    async close() {
      for (const timer of timers) clearTimeout(timer)
      for (const child of children) child.kill()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
    },
  }
}
