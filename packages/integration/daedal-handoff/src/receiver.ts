/** Authenticated handoff intake mounted only in a separate host Web profile. @module */
import { timingSafeEqual } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { stat } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPromptRequest } from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-subprocess'
import { HANDOFF_PATH, handoffSessionId, requestSchema, destinationSchema } from './protocol.ts'

export const name = 'daedal-handoff-receiver'
export const inject = ['webServer', 'sessionController', 'fs', 'subprocess']

/** Fixed host destination and bounded authenticated intake. */
export interface Config {
  /** Name displayed during source confirmation. */
  name: string
  /** Browser origin advertised for this host; transport may use a separate loopback origin. */
  publicUrl?: string
  /** Absolute destination workspace; callers cannot choose another directory. */
  cwd: string
  /** Dedicated shared secret known only to the two host control planes. */
  token: string
  /** Maximum complete UTF-8 request size. */
  maxBytes: number
  /** Deadline for reading and admitting a request; active intake is aborted on unload. */
  timeoutMs: number
}

export const Config: z<Config> = z.object({
  publicUrl: z.string(),
  name: z.string().required(), cwd: z.string().required(), token: z.string().required(),
  maxBytes: z.number().step(1).min(1).default(65_536),
  timeoutMs: z.number().step(1).min(1).default(15_000),
})

/** Send bounded protocol data without request bodies, credentials, or exception text. */
function respond(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

/**
 * Admit approved tasks into ordinary host Sessions through the Session Controller.
 * @param ctx - separately launched host profile with Web and Session APIs.
 * @param config - destination identity and authentication settings.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const host = Symbol.for('@deepseek-ai/dsh/host-execution-world')
  const assertHost = (): void => {
    if (ctx.fs.executionWorld !== host || ctx.subprocess.executionWorld !== host) {
      throw new Error('daedal-handoff receiver requires host filesystem and subprocess providers in a separate host profile')
    }
  }
  assertHost()
  if (!config.name.trim() || !isAbsolute(config.cwd) || config.token.length < 32) {
    throw new Error('daedal-handoff receiver requires a name, absolute cwd, and a dedicated token of at least 32 characters')
  }
  if (!(await stat(config.cwd)).isDirectory()) throw new Error('daedal-handoff destination cwd must be a directory')
  const destination = destinationSchema.parse({ name: config.name, cwd: config.cwd,
    ...config.publicUrl === undefined ? {} : { url: config.publicUrl },
  })
  const expected = Buffer.from(`Bearer ${config.token}`)
  const active = new Set<Promise<void>>()
  const admission = new Map<string, Promise<void>>()
  const lifetime = new AbortController()
  ctx.effect(() => async () => {
    lifetime.abort()
    await Promise.allSettled([...active])
  }, 'daedal-handoff receiver lifetime')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: HANDOFF_PATH, handler: (req, res) => {
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(config.timeoutMs)])
    const stopIntake = (): void => { if (!req.complete) req.destroy() }
    signal.addEventListener('abort', stopIntake, { once: true })
    const work = (async () => {
      const actual = Buffer.from(req.headers.authorization ?? '')
      if (req.headers.origin !== undefined || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        req.resume(); respond(res, 401, { error: 'Unauthorized handoff' }); return
      }
      assertHost()
      signal.throwIfAborted()
      if (req.method === 'GET') { respond(res, 200, destination); return }
      if (req.method !== 'POST') { req.resume(); respond(res, 405, { error: 'Use GET or POST' }); return }
      if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
        req.resume(); respond(res, 415, { error: 'Expected application/json' }); return
      }
      const chunks: Buffer[] = []
      let size = 0
      if (Number(req.headers['content-length']) > config.maxBytes) {
        req.resume(); respond(res, 413, { error: 'Handoff is too large' }); return
      }
      for await (const data of req) {
        const chunk = Buffer.from(data as Uint8Array)
        size += chunk.length
        if (size > config.maxBytes) { req.resume(); respond(res, 413, { error: 'Handoff is too large' }); return }
        chunks.push(chunk)
      }
      let value: unknown
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) }
      catch { respond(res, 400, { error: 'Expected UTF-8 JSON' }); return }
      const parsed = requestSchema.safeParse(value)
      if (!parsed.success) { respond(res, 400, { error: 'Invalid handoff fields or Daedal mode' }); return }
      const request = parsed.data
      if (request.destination.name !== destination.name || request.destination.cwd !== destination.cwd
        || request.destination.url !== destination.url) {
        respond(res, 409, { error: 'Destination changed; request a new human confirmation' }); return
      }
      const sessionId = SessionId(handoffSessionId(request))
      let pending = admission.get(sessionId)
      if (pending === undefined) {
        pending = (async () => {
          assertHost()
          signal.throwIfAborted()
          await ctx.sessionController.create({ sessionId, cwd: config.cwd, agentPreset: request.preset })
          signal.throwIfAborted()
          assertHost()
          await ctx.sessionController.prompt({ sessionId,
            requestId: sessionId as unknown as SessionPromptRequest['requestId'], mode: 'queue',
            content: [{ type: 'text', text: `# ${request.title}\n\nThe user confirmed this handoff from Daedal session ${request.sourceSessionId} to ${config.name}. Continue the approved task below in this host session. The source session remains isolated.\n\n${request.task}` }],
          }, signal)
        })()
        admission.set(sessionId, pending)
      }
      try { await pending } finally { if (admission.get(sessionId) === pending) admission.delete(sessionId) }
      respond(res, 200, { sessionId, accepted: true })
    })().catch(() => {
      // Protocol errors intentionally omit host exception details and submitted task text.
      respond(res, 503, { error: 'Host handoff could not be acknowledged; inspect the destination session before retrying' })
    }).finally(() => { signal.removeEventListener('abort', stopIntake); active.delete(work) })
    active.add(work)
    return work
  } }), 'daedal-handoff receiver route')
}
