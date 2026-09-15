/** Provider account sign-in over the authorization service and a cancellable progress stream. */
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AuthorizationPrompt } from '@deepseek-ai/dsh-authorization'
import type {} from '@deepseek-ai/dsh-credentials'
import { parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { AccountAttemptId, AccountPromptId, ProviderAccount, ProviderAccountPrompt, ProviderAccountUpdate } from './types.ts'

/** Maximum time a browser may leave one sign-in running. */
interface Config { timeoutMs?: number }

const DEFAULT_SIGN_IN_TIMEOUT_MS = 900_000

interface Attempt {
  key: CredentialKey
  controller: AbortController
  done: Promise<void>
  answer?: ((promptId: AccountPromptId, value: string) => void) | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of provider account authorization operations. */
    authorizationController: AuthorizationController
  }
}

/** Validate the wire address without reflecting a credential value in a failure. */
function keyOf(value: string): CredentialKey {
  try { return parseCredentialKey(value) } catch {
    throw new RemoteError('gateway/bad-request', 'Invalid account address.', {})
  }
}

/** Project notice URLs onto browser navigation schemes only. */
function browserUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href
  } catch { /* A malformed provider URL is not a browser action. */ }
  return undefined
}

/** Redacted account operations for the Models page. */
export class AuthorizationController extends TypertRemoteService {
  static Config: Schema<Config> = Schema.object({ timeoutMs: Schema.number().min(1000).default(DEFAULT_SIGN_IN_TIMEOUT_MS) })
  private readonly attempts = new Map<AccountAttemptId, Attempt>()
  private readonly timeoutMs: number

  /**
   * @param ctx - Host context carrying the credential and authorization services.
   * @param config - maximum sign-in duration.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'authorizationController', { namespace: 'authorization' })
    this.timeoutMs = config.timeoutMs ?? DEFAULT_SIGN_IN_TIMEOUT_MS
    ctx.effect(() => async () => {
      const attempts = [...this.attempts.values()]
      for (const attempt of attempts) attempt.controller.abort()
      await Promise.all(attempts.map(attempt => attempt.done))
    }, 'authorization-controller: cancel owned sign-ins')
  }

  /**
   * List accounts available to this settings surface.
   * @returns registered account methods and stored presence, without secret values.
   */
  @Remote
  async list(): Promise<ProviderAccount[]> {
    const authorization = this.ctx.get('authorization')
    const credentials = this.ctx.get('credentials')
    if (authorization === undefined || credentials === undefined) return []
    return Promise.all(authorization.list().map(async entry => ({
      key: entry.key, label: entry.label,
      methods: entry.methods.map(method => ({ id: method.id, label: method.label })),
      configured: (await credentials.describeRecord(entry.key)).configured,
      inFlight: entry.inFlight,
    })))
  }

  /**
   * Stream one sign-in; closing the stream cancels it and discards its prompts.
   * @param key - credential record address offered by list.
   * @param method - method offered by that account.
   * @param signal - browser stream lifetime.
   * @returns progress, interactive questions, and one terminal outcome.
   */
  @Remote({ mode: 'stream' })
  async *signIn(key: string, method: string, signal: AbortSignal): AsyncIterable<ProviderAccountUpdate> {
    const address = keyOf(key)
    const authorization = this.ctx.get('authorization')
    const flow = authorization?.describe(address)
    if (authorization === undefined || flow === undefined || !flow.methods.some(choice => choice.id === method)) {
      throw new RemoteError('gateway/bad-request', 'This account sign-in method is unavailable.', {})
    }
    if (flow.inFlight || [...this.attempts.values()].some(attempt => attempt.key === address)) {
      throw new RemoteError('gateway/bad-request', 'Account sign-in is already running.', {})
    }
    const id = brandString<AccountAttemptId>(randomUUID())
    const controller = new AbortController()
    const lifetime = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(this.timeoutMs)])
    const attempt: Attempt = { key: address, controller, done: Promise.resolve() }
    this.attempts.set(id, attempt)
    let state: ProviderAccountUpdate = { id, status: 'pending' }
    let latest: ProviderAccountUpdate | undefined = state
    let wake: (() => void) | undefined
    const publish = (update: Partial<ProviderAccountUpdate>): void => {
      state = { ...state, ...update }
      latest = state
      wake?.()
    }
    const ask = (prompt: AuthorizationPrompt): Promise<string> => {
      const promptId = brandString<AccountPromptId>(randomUUID())
      const question: ProviderAccountPrompt = {
        id: promptId, kind: prompt.kind, message: prompt.message,
        ...prompt.kind === 'select' ? {
          options: prompt.options.map(option => ({ id: option.id, label: option.label,
            ...option.description === undefined ? {} : { description: option.description } })),
        } : { ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder } },
      }
      return new Promise<string>((resolve, reject) => {
        const promptSignal = prompt.signal === undefined ? lifetime : AbortSignal.any([lifetime, prompt.signal])
        const finish = (value?: string): void => {
          promptSignal.removeEventListener('abort', abort)
          attempt.answer = undefined
          publish({ prompt: undefined })
          if (value === undefined) reject(new Error('Account prompt was withdrawn.'))
          else resolve(value)
        }
        const abort = (): void => { finish() }
        if (promptSignal.aborted) { finish(); return }
        attempt.answer = (submitted, value) => {
          if (submitted !== promptId || (prompt.kind === 'select' && !prompt.options.some(option => option.id === value))) {
            throw new RemoteError('gateway/bad-request', 'The account question or choice is no longer available.', {})
          }
          finish(value)
        }
        promptSignal.addEventListener('abort', abort, { once: true })
        publish({ prompt: question })
      })
    }
    attempt.done = authorization.begin({
      key: address, method, signal: lifetime,
      interaction: {
        notify: (notice) => {
          if (lifetime.aborted) return
          publish({ message: notice.message,
            ...notice.url === undefined ? {} : { url: browserUrl(notice.url) },
            ...notice.code === undefined ? {} : { code: notice.code } })
        },
        prompt: ask,
      },
    }).then((outcome) => { publish({ status: outcome.status, prompt: undefined }) }, () => {
      publish({ status: lifetime.aborted ? 'cancelled' : 'failed', prompt: undefined,
        message: 'Account sign-in failed. Please try again.' })
    })
    try {
      while (true) {
        if (latest === undefined) await new Promise<void>((resolve) => { wake = resolve })
        const next = latest
        latest = undefined
        if (next === undefined) continue
        yield next
        if (next.status !== 'pending') return
      }
    } finally {
      controller.abort()
      await attempt.done
      this.attempts.delete(id)
    }
  }

  /**
   * Answer the current question; the answer is never returned or logged.
   * @param id - attempt id from the progress stream.
   * @param promptId - current question id.
   * @param value - typed text or selected option.
   */
  @Remote
  answer(id: AccountAttemptId, promptId: AccountPromptId, value: string): void {
    const answer = this.attempts.get(id)?.answer
    if (answer === undefined) throw new RemoteError('gateway/bad-request', 'The account question is no longer available.', {})
    answer(promptId, value)
  }

  /**
   * Cancel a running attempt.
   * @param id - attempt id from the progress stream.
   */
  @Remote
  cancel(id: AccountAttemptId): void { this.attempts.get(id)?.controller.abort() }

  /**
   * Cancel account sign-in before removing its stored credential.
   * @param key - credential record address offered by list.
   */
  @Remote
  async signOut(key: string): Promise<void> {
    const address = keyOf(key)
    const authorization = this.ctx.get('authorization')
    const credentials = this.ctx.get('credentials')
    if (authorization?.describe(address) === undefined || credentials === undefined) {
      throw new RemoteError('gateway/bad-request', 'This account is unavailable.', {})
    }
    authorization.cancel(address)
    const attempts = [...this.attempts.values()].filter(attempt => attempt.key === address)
    for (const attempt of attempts) attempt.controller.abort()
    await Promise.all(attempts.map(attempt => attempt.done))
    await credentials.deleteRecord(address)
  }
}
