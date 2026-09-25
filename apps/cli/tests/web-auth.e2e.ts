/** Real Web-profile authentication and native metadata against isolated Harness homes. */

import type { ChildProcess } from 'node:child_process'
import { spawn, spawnSync } from 'node:child_process'
import { stat, readFile, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { serverResponseSchema } from '@deepseek-ai/dsh-client-connection'
import { connectionIdentitySchema } from '@deepseek-ai/dsh-client-connection/identity'
import { discoveryConfig } from '../../../packages/client/connection/tests/discovery-fixture.ts'
import { hostAdvertisementSchema, hostDiscoveryResultSchema, HOST_ADVERTISEMENT_PATH } from '../../../packages/client/connection/src/discovery-protocol.ts'
import { connectionDeviceGrantSchema } from '../../../packages/client/connection/src/device-protocol.ts'
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
async function startWeb(root: string, dshHome: string, port: number, patch?: string): Promise<RunningWeb> {
  const child = spawn(process.execPath, [
    '--import', TSX_LOADER,
    DSH_SOURCE_BIN,
    '--profile', 'web',
    ...patch === undefined ? [] : ['--patch', patch],
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
  expect(facts.version).toBe(3)
  expect(facts.capabilities.filter(row => ['session/list', 'session/follow', 'workspace/follow'].includes(row.endpoint)))
    .toEqual([
      { endpoint: 'session/follow', mode: 'stream', availability: 'available', semanticRevision: 1, wireFingerprint: expect.stringMatching(/^typert-wire-v1:[0-9a-f]{64}$/) as unknown },
      { endpoint: 'session/list', mode: 'unary', availability: 'available', semanticRevision: 1, wireFingerprint: expect.stringMatching(/^typert-wire-v1:[0-9a-f]{64}$/) as unknown },
      { endpoint: 'workspace/follow', mode: 'stream', availability: 'available', semanticRevision: 1, wireFingerprint: expect.stringMatching(/^typert-wire-v1:[0-9a-f]{64}$/) as unknown },
    ])
  const endpoints = facts.capabilities.map(row => row.endpoint)
  expect(endpoints).toEqual([...new Set(endpoints)].sort())
  return facts
}

/** Exercise the built Client facade on the authenticated HTTP and WebSocket carriers. */
function verifyNativeAdmission(
  origin: string, auth: { cookie: string } | { bearer: string; revoke?: { cookie: string; deviceId: string } },
  hostId: string, activationId: string,
): void {
  const require = createRequire(join(REPO_ROOT, 'packages/api/remotes/package.json'))
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    const api = await import(process.argv[1]);
    const { Context } = await import(process.argv[2]);
    const { default: WebSocket } = await import(process.argv[3]);
    const [baseUrl, encodedAuth, expectedHostId, activationId] = process.argv.slice(4);
    const auth = JSON.parse(encodedAuth);
    const headers = { ...auth.bearer ? { Authorization: 'Bearer ' + auth.bearer } : { Cookie: auth.cookie }, Origin: baseUrl };
    const requiredCapabilities = api.selectRemoteCapabilities(['settings/describe', 'session/list', 'session/follow', 'workspace/follow']);
    let metadataReads = 0;
    const rpc = api.createConnectionRpc({ baseUrl, randomId: () => crypto.randomUUID(),
      fetch: (input, init) => {
        if (input.pathname.endsWith('/$capabilities')) metadataReads++;
        return fetch(input, { ...init, headers: { ...init.headers, ...headers } });
      },
    });
    const connection = api.createConnection({ isLoopback: false, rpc });
    const ctx = new Context();
    await ctx.plugin({ inject: api.registryInject, apply: api.applyRegistry });
    ctx.provide('connection', connection);
    let gateway;
    let assembly;
    try {
      gateway = ctx.plugin({ inject: ['typert', 'connection'], apply(scope) {
        api.applyRemoteClient(scope, { baseUrl, expectedHostId, requiredCapabilities,
          randomId: () => crypto.randomUUID(), createAbortController: () => new AbortController(),
          createSocket: url => new WebSocket(url, { headers }),
        });
      } });
      await gateway;
      if (!connection.generation.getSnapshot()) await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { stop(); reject(new Error('native admission did not become ready')); }, 15000);
        const stop = connection.generation.subscribe(() => {
          if (connection.generation.getSnapshot()) { clearTimeout(timer); stop(); resolve(); }
        });
      });
      assert.equal(metadataReads, 1);
      assert.equal(ctx.remote.$host.identity.hostId, expectedHostId);
      assert.equal(ctx.remote.$host.capabilities.identity.activationId, activationId);
      for (const requirement of requiredCapabilities) {
        const accepted = ctx.remote.$host.capabilities.capabilities.find(row => row.endpoint === requirement.endpoint);
        assert.equal(accepted.wireFingerprint, requirement.wireFingerprint);
        assert.equal(accepted.semanticRevision, requirement.semanticRevision);
      }
      assembly = ctx.plugin(api);
      await assembly;
      const settings = await ctx.remote.settings.describe();
      assert.equal(settings.ok, true);
      assert.ok(Array.isArray(settings.value.namespaces));
      if (auth.revoke) {
        const lost = new Promise((resolve, reject) => {
          const timer = setTimeout(() => { stop(); reject(new Error('device revocation did not close the generation')); }, 5000);
          const stop = connection.generation.subscribe(() => {
            if (!connection.generation.getSnapshot()) { clearTimeout(timer); stop(); resolve(); }
          });
        });
        const revoke = await fetch(new URL('/api/connection/devices/revoke', baseUrl), {
          method: 'POST', headers: { Cookie: auth.revoke.cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: auth.revoke.deviceId }),
        });
        assert.equal(revoke.status, 200);
        assert.deepEqual(await revoke.json(), { ok: true, value: { revoked: true } });
        await lost;
        assert.equal(ctx.remote.$host.capabilities, undefined);
        const refused = await fetch(new URL('/api/connection/identity', baseUrl), { method: 'POST', headers });
        assert.equal(refused.status, 401);
      }
      const remote = ctx.remote;
      await assembly.dispose(); assembly = undefined;
      await gateway.dispose(); gateway = undefined;
      assert.equal(connection.generation.getSnapshot(), undefined);
      assert.equal(remote.$host.capabilities, undefined);
      process.stdout.write('native admission and generated settings call passed');
    } finally {
      await assembly?.dispose();
      await gateway?.dispose();
    }
  `, ...['@deepseek-ai/dsh-api-remotes/client/portable', '@deepseek-ai/cordis'].map(name => pathToFileURL(require.resolve(name)).href),
  pathToFileURL(createRequire(join(REPO_ROOT, 'apps/cli/package.json')).resolve('ws')).href,
  origin, JSON.stringify(auth), hostId, activationId], { encoding: 'utf8', timeout: 30_000 })
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.signal, result.stderr).toBeNull()
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toBe('native admission and generated settings call passed')
}

describe('dsh web authentication through the real CLI', () => {
  it.skipIf(process.platform === 'win32')('mounts opt-in discovery through the Loader with a controlled POSIX status executable', { retry: 0 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-web-discovery-'))
    const statusCommand = join(root, 'tailscale')
    const patch = join(root, 'discovery.patch.yml')
    let running: RunningWeb | undefined
    try {
      await writeFile(statusCommand, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({ BackendState: 'Running', Peer: {}, private: 'omitted' }))\n`, { mode: 0o700 })
      await writeFile(patch, JSON.stringify([{ id: 'connection', config: {
        deviceAccess: { enrollmentTtlMs: 300_000, maxPendingEnrollments: 2, maxDevices: 2 },
        discovery: { ...discoveryConfig, executable: statusCommand },
      } }]))
      running = await startWeb(root, join(root, '.dsh'), 0, patch)
      const url = new URL(running.launchUrl)
      const exchange = await fetch(running.launchUrl, { redirect: 'manual', signal: AbortSignal.timeout(30_000) })
      const cookie = exchange.headers.get('set-cookie')?.split(';', 1)[0]
      if (cookie === undefined) throw new Error('missing browser cookie')
      const advertisement = await fetch(url.origin + HOST_ADVERTISEMENT_PATH, { signal: AbortSignal.timeout(10_000) })
      expect(advertisement.status).toBe(200); expect(advertisement.headers.get('cache-control')).toBe('no-store')
      const metadata = hostAdvertisementSchema.parse(await advertisement.json())
      const identity = connectionIdentitySchema.parse(rpcValue(await postRpc(Number(url.port), url.host, 'connection/identity', {}, cookie)))
      expect(metadata).toEqual({ version: 1, identity, label: discoveryConfig.label })
      expect((await fetch(url.origin + HOST_ADVERTISEMENT_PATH + '?extra=1')).status).toBe(401)
      expect((await fetch(url.origin + HOST_ADVERTISEMENT_PATH, { headers: { origin: 'http://untrusted.invalid' } })).status).toBe(403)
      expect((await fetch(url.origin + HOST_ADVERTISEMENT_PATH, { headers: { authorization: 'Bearer invalid', cookie } })).status).toBe(401)
      expect((await postRpc(Number(url.port), url.host, 'connection/discovery', {})).status).toBe(401)
      const result = hostDiscoveryResultSchema.parse(rpcValue(await postRpc(Number(url.port), url.host, 'connection/discovery', {}, cookie)))
      expect(result).toEqual({ version: 1, host: identity, status: 'ready', truncated: false, candidates: [] })
      const enroll = await fetch(url.origin + '/api/connection/devices/enroll', { method: 'POST',
        headers: { cookie, 'content-type': 'application/json' }, body: '{}' })
      const enrolled = await enroll.json() as { value: { hostId: string; challenge: string } }
      const claim = await fetch(url.origin + '/api/connection/devices/claim', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hostId: enrolled.value.hostId, challenge: enrolled.value.challenge, label: 'Discovery device' }) })
      const grant = connectionDeviceGrantSchema.parse((await claim.json() as { value: unknown }).value)
      const scan = await fetch(url.origin + '/api/connection/discovery', { method: 'POST',
        headers: { authorization: `Bearer ${grant.credential}`, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'device-discovery', method: 'connection/discovery', payload: {} }) })
      expect(scan.status).toBe(200)
      expect(await scan.json()).toMatchObject({ result: { ok: true, value: result } })
      const revoked = await fetch(url.origin + '/api/connection/devices/revoke', { method: 'POST', headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId: grant.device.deviceId }) })
      expect(revoked.status).toBe(200)
      expect((await fetch(url.origin + '/api/connection/discovery', { method: 'POST', headers: { authorization: `Bearer ${grant.credential}` } })).status).toBe(401)
      const exit = await stopWeb(running); expect(exit.signal).not.toBe('SIGKILL'); running = undefined
    } finally { if (running !== undefined) await stopWeb(running); await rm(root, { recursive: true, force: true }) }
  })

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
      expect((await fetch(firstUrl.origin + HOST_ADVERTISEMENT_PATH)).status).toBe(401)
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
      verifyNativeAdmission(firstUrl.origin, { cookie }, identity.hostId, identity.activationId)
      const settings = capabilities.capabilities.find(row => row.endpoint === 'settings/describe')!
      const compatibility = { wireFingerprint: settings.wireFingerprint, semanticRevision: settings.semanticRevision, identity }
      expect(rpcValue(await postRpc(port, firstUrl.host, 'settings/describe', { args: {}, compatibility }, cookie)))
        .toMatchObject({ namespaces: expect.any(Array) as unknown })
      for (const changed of [{ ...compatibility, semanticRevision: 2 },
        { ...compatibility, wireFingerprint: `typert-wire-v1:${'a'.repeat(64)}` },
      ]) {
        const refused = await postRpc(port, firstUrl.host, 'settings/describe', { args: {}, compatibility: changed }, cookie)
        expect(JSON.parse(refused.body)).toMatchObject({ result: { ok: false, error: {
          code: 'gateway/api-incompatible', details: { endpoint: 'settings/describe' },
        } } })
      }
      expect(await postRpc(port, 'example.invalid', '$capabilities', {}, cookie)).toEqual({ status: 403, body: 'forbidden' })

      const devicePost = async (origin: string, route: string, body: unknown, headers: Record<string, string> = {}) => fetch(new URL(`/api/connection/devices/${route}`, origin), {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
      })
      const enrolled = await devicePost(firstUrl.origin, 'enroll', {}, { cookie })
      expect(enrolled.status).toBe(200)
      const enrollment = await enrolled.json() as { value: { hostId: string; challenge: string } }
      const claim = { hostId: enrollment.value.hostId, challenge: enrollment.value.challenge, label: 'iPhone fixture' }
      const claimed = await devicePost(firstUrl.origin, 'claim', claim)
      expect(claimed.status).toBe(200)
      const grant = connectionDeviceGrantSchema.parse((await claimed.json() as { value: unknown }).value)
      expect(grant.hostId).toBe(identity.hostId)
      expect((await devicePost(firstUrl.origin, 'claim', claim)).status).toBe(401)
      verifyNativeAdmission(firstUrl.origin, { bearer: grant.credential }, identity.hostId, identity.activationId)
      const unclaimed = await devicePost(firstUrl.origin, 'enroll', {}, { cookie })
      const staleEnrollment = await unclaimed.json() as { value: { hostId: string; challenge: string } }
      const stored = await readFile(join(dshHome, '.credentials.yaml'), 'utf8')
      expect(stored.includes(grant.credential)).toBe(false)
      expect(stored.includes(claim.challenge)).toBe(false)

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
      verifyNativeAdmission(secondUrl.origin, { cookie }, nextIdentity.hostId, nextIdentity.activationId)
      const expiredClaim = { hostId: staleEnrollment.value.hostId, challenge: staleEnrollment.value.challenge, label: 'Unclaimed phone' }
      expect((await devicePost(secondUrl.origin, 'claim', expiredClaim)).status).toBe(401)
      verifyNativeAdmission(secondUrl.origin, { bearer: grant.credential, revoke: { cookie, deviceId: grant.device.deviceId } },
        nextIdentity.hostId, nextIdentity.activationId)
      const devices = await fetch(new URL('/api/connection/devices', secondUrl.origin), { headers: { cookie } })
      expect(devices.status).toBe(200)
      expect(await devices.json()).toMatchObject({ ok: true, value: { devices: [] } })
      const stale = await postRpc(secondPort, secondUrl.host, 'settings/describe', { args: {}, compatibility }, cookie)
      expect(JSON.parse(stale.body)).toMatchInlineSnapshot(`
        {
          "result": {
            "error": {
              "code": "gateway/api-incompatible",
              "details": {
                "endpoint": "settings/describe",
              },
              "message": "typert gateway: settings/describe: Remote request belongs to another Host activation",
            },
            "ok": false,
          },
          "rpcId": "web-auth-real-cli",
          "type": "server-response",
        }
      `)
      expect(rpcValue(await postRpc(secondPort, secondUrl.host, 'settings/describe', {
        args: {}, compatibility: { ...compatibility, identity: nextIdentity },
      }, cookie))).toMatchObject({ namespaces: expect.any(Array) as unknown })

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
