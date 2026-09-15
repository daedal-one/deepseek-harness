/** Real Web-profile authentication and native metadata against isolated Harness homes. */

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { serverResponseSchema } from '@deepseek-ai/dsh-client-connection'
import { connectionIdentitySchema } from '@deepseek-ai/dsh-client-connection/identity'
import type { HostCapabilities } from '@deepseek-ai/dsh-api-gateway/types'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const DSH_SOURCE_BIN = join(REPO_ROOT, 'apps/cli/src/bin.ts')
const TSX_LOADER = pathToFileURL(createRequire(join(REPO_ROOT, 'package.json')).resolve('tsx/esm')).href

interface ChildExit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}

interface RunningWeb {
  readonly closed: Promise<ChildExit>
  readonly child: ChildProcess
  readonly launchUrl: string
  readonly output: () => string
}

interface HttpResult {
  readonly status: number
  readonly body: string
}

function redact(output: string): string {
  return output.replace(/([?&]token=)[^\s)]+/gu, '$1<redacted>')
}

function cleanEnvironment(root: string, dshHome: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(name)))
  return {
    ...env,
    DSH_AGENTS_HOME: join(root, '.agents'),
    DSH_HOME: dshHome,
    DSH_TELEMETRY_DISABLED: '1',
    NODE_NO_WARNINGS: '1',
    SSH_CONNECTION: '',
    SSH_TTY: '',
    TSX_TSCONFIG_PATH: join(REPO_ROOT, 'tsconfig.json'),
  }
}

/** Start the public source CLI and wait for its authenticated readiness URL. */
async function startWeb(root: string, dshHome: string, port: number): Promise<RunningWeb> {
  const child = spawn(process.execPath, [
    '--import', TSX_LOADER,
    DSH_SOURCE_BIN,
    '--profile', 'web',
    '--no-open',
    '--port', String(port),
  ], {
    cwd: root,
    env: cleanEnvironment(root, dshHome),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const closed = new Promise<ChildExit>((resolve) => {
    child.once('close', (code, signal) => { resolve({ code, signal }) })
  })
  let output = ''
  try {
    const launchUrl = await new Promise<string>((resolve, reject) => {
      let settled = false
      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      }
      const timer = setTimeout(() => {
        fail(new Error(`dsh web did not become ready:\n${redact(output)}`))
      }, 90_000)
      const append = (chunk: Buffer | string): void => {
        output = `${output}${String(chunk)}`.slice(-100_000)
        const match = /dsh web: (http:\/\/[^\s]+)/u.exec(output)
        if (settled || match?.[1] === undefined) return
        settled = true
        clearTimeout(timer)
        resolve(match[1])
      }
      child.stdout?.on('data', append)
      child.stderr?.on('data', append)
      child.once('error', (error) => {
        fail(error)
      })
      child.once('exit', (code) => {
        fail(new Error(`dsh web exited before readiness (${String(code)}):\n${redact(output)}`))
      })
    })
    return { child, closed, launchUrl, output: () => output }
  } catch (error) {
    await stopWeb({ child, closed })
    throw error
  }
}

async function stopWeb(running: Pick<RunningWeb, 'child' | 'closed'>): Promise<ChildExit> {
  if (running.child.pid !== undefined && running.child.exitCode === null && running.child.signalCode === null) {
    running.child.kill('SIGTERM')
  }
  const forced = setTimeout(() => { running.child.kill('SIGKILL') }, 10_000)
  forced.unref()
  try { return await running.closed } finally { clearTimeout(forced) }
}

/** POST one real Remote envelope while controlling the wire Host header. */
function postRpc(port: number, host: string, endpoint: string, payload: object, cookie?: string): Promise<HttpResult> {
  const body = JSON.stringify({
    type: 'client-request',
    rpcId: 'web-auth-real-cli',
    method: endpoint,
    payload,
  })
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: `/api/${endpoint}`,
      method: 'POST',
      headers: {
        host,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...cookie === undefined ? {} : { cookie },
      },
    }, (res) => {
      const chunks: Uint8Array[] = []
      res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    req.once('error', reject)
    req.setTimeout(30_000, () => { req.destroy(new Error(`Web RPC ${endpoint} timed out`)) })
    req.end(body)
  })
}

function describeSettings(port: number, host: string, cookie?: string): Promise<HttpResult> {
  return postRpc(port, host, 'settings/describe', { args: {} }, cookie)
}

function rpcValue(response: HttpResult): unknown {
  expect(response.status).toBe(200)
  const envelope = serverResponseSchema.parse(JSON.parse(response.body))
  expect(envelope.rpcId).toBe('web-auth-real-cli')
  if (!envelope.result.ok) throw new Error(`${envelope.result.error.code}: ${envelope.result.error.message}`)
  return envelope.result.value
}

function expectNativeCapabilities(value: unknown): HostCapabilities {
  const facts = value as HostCapabilities
  expect(facts.version).toBe(1)
  expect(facts.capabilities.filter(row => ['session/list', 'session/follow', 'workspace/follow'].includes(row.endpoint)))
    .toEqual([
      { endpoint: 'session/follow', mode: 'stream', availability: 'available' },
      { endpoint: 'session/list', mode: 'unary', availability: 'available' },
      { endpoint: 'workspace/follow', mode: 'stream', availability: 'available' },
    ])
  const endpoints = facts.capabilities.map(row => row.endpoint)
  expect(endpoints).toEqual([...new Set(endpoints)].sort())
  return facts
}

describe('dsh web authentication through the real CLI', () => {
  it('authorizes native metadata and retains Host identity and browser access across restart', { timeout: 180_000, retry: 0 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-web-auth-real-cli-'))
    const dshHome = join(root, '.dsh')
    let first: RunningWeb | undefined
    let second: RunningWeb | undefined
    try {
      first = await startWeb(root, dshHome, 0)
      const firstUrl = new URL(first.launchUrl)
      expect(firstUrl.hostname).toBe('127.0.0.1')
      const port = Number(firstUrl.port)
      expect(port).toBeGreaterThan(0)
      expect(firstUrl.pathname).toBe('/')
      expect(firstUrl.searchParams.get('token')).toMatch(/^[A-Za-z0-9_-]{43}$/u)

      expect(await describeSettings(port, `localhost:${String(port)}`)).toEqual({
        status: 401,
        body: 'unauthorized',
      })

      for (const endpoint of ['connection/identity', '$capabilities']) {
        expect(await postRpc(port, firstUrl.host, endpoint, {})).toEqual({ status: 401, body: 'unauthorized' })
      }

      const exchange = await fetch(first.launchUrl, { redirect: 'manual', signal: AbortSignal.timeout(30_000) })
      expect(exchange.status).toBe(303)
      expect(exchange.headers.get('location')).toBe('/')
      const setCookie = exchange.headers.get('set-cookie')
      if (setCookie === null) throw new Error('real CLI token exchange omitted Set-Cookie')
      expect(setCookie).toContain('HttpOnly')
      expect(setCookie).toContain('SameSite=Strict')
      expect(setCookie).not.toContain('Secure')
      const cookie = setCookie.split(';', 1)[0]!

      const authenticated = await describeSettings(port, firstUrl.host, cookie)
      expect(authenticated.status).toBe(200)
      const authenticatedBody = JSON.parse(authenticated.body) as unknown
      expect(authenticatedBody).toMatchObject({
        type: 'server-response',
        rpcId: 'web-auth-real-cli',
        result: { ok: true, value: { namespaces: expect.any(Array) as unknown } },
      })

      const identity = connectionIdentitySchema.parse(rpcValue(await postRpc(port, firstUrl.host, 'connection/identity', {}, cookie)))
      const capabilities = expectNativeCapabilities(rpcValue(await postRpc(port, firstUrl.host, '$capabilities', {}, cookie)))
      expect(capabilities.identity).toEqual(identity)
      expect(await postRpc(port, 'example.invalid', '$capabilities', {}, cookie)).toEqual({ status: 403, body: 'forbidden' })

      const firstExit = await stopWeb(first)
      expect(firstExit.signal).not.toBe('SIGKILL')
      first = undefined
      // Browser credentials are bound to the request authority, including its port.
      second = await startWeb(root, dshHome, port)
      const secondUrl = new URL(second.launchUrl)
      expect(secondUrl.searchParams.get('token')).not.toBe(firstUrl.searchParams.get('token'))
      const secondPort = Number(secondUrl.port)
      expect((await describeSettings(secondPort, secondUrl.host, cookie)).status).toBe(200)
      const nextIdentity = connectionIdentitySchema.parse(rpcValue(await postRpc(secondPort, secondUrl.host, 'connection/identity', {}, cookie)))
      expect(nextIdentity.hostId).toBe(identity.hostId)
      expect(nextIdentity.activationId).not.toBe(identity.activationId)
      const nextCapabilities = expectNativeCapabilities(rpcValue(await postRpc(secondPort, secondUrl.host, '$capabilities', {}, cookie)))
      expect(nextCapabilities.identity).toEqual(nextIdentity)

      const credentialMode = (await stat(join(dshHome, '.credentials.yaml'))).mode & 0o777
      if (process.platform !== 'win32') expect(credentialMode).toBe(0o600)
    } catch (error) {
      const evidence = [first?.output(), second?.output()].filter(value => value !== undefined).join('\n')
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${redact(evidence)}`, { cause: error })
    } finally {
      if (second !== undefined) await stopWeb(second)
      if (first !== undefined) await stopWeb(first)
      await rm(root, { recursive: true, force: true })
    }
  })
})
