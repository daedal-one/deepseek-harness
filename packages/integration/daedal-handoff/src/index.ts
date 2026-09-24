/** Host-owned destination and mandatory human confirmation for Daedal handoffs. @module */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-user-questions'
import { HANDOFF_PATH, daedalPreset, destinationSchema, handoffSessionId, receiptSchema, taskSchema } from './protocol.ts'
import { isHostExecution } from './world.ts'
import type { HandoffResult } from './types.ts'
export type { HandoffResult } from './types.ts'

/** Deployment-owned destination; omitted leaves handoff unavailable. */
export interface Config {
  /** Separate host profile's HTTP origin, HTTPS except for loopback. */
  destinationUrl?: string
  /** Dedicated receiver token, supplied from host credentials, never model arguments. */
  token?: string
  /** Deadline for each destination request, excluding human review time. */
  timeoutMs: number
  /** Complete request and response byte ceiling. */
  maxBytes: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    daedalHandoff: DaedalHandoff
  }
}

/** Configured transport with a human decision before every task dispatch. */
export class DaedalHandoff extends Service {
  static inject = ['agents', 'sessionProjections', 'userQuestions', 'fs', 'subprocess']
  static Config: z<Config> = z.object({
    destinationUrl: z.string(), token: z.string(),
    timeoutMs: z.number().step(1).min(1).default(15_000),
    maxBytes: z.number().step(1).min(1).default(65_536),
  })

  private readonly destination: { endpoint: URL; token: string } | undefined
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<HandoffResult>>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'daedalHandoff')
    ctx.effect(() => async () => {
      this.lifetime.abort()
      await Promise.allSettled([...this.pending])
    }, 'daedal handoff requests')
    if (config.destinationUrl === undefined && config.token === undefined) return
    if (config.destinationUrl === undefined || config.token === undefined) {
      throw new Error('daedal-handoff requires both destinationUrl and token, or neither')
    }
    const url = new URL(config.destinationUrl)
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
      || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))
      || config.token.length < 32) throw new Error('daedal-handoff requires an HTTPS or loopback HTTP origin and a dedicated token of at least 32 characters')
    this.destination = { endpoint: new URL(HANDOFF_PATH, url), token: config.token }
  }

  /**
   * Review one complete task and dispatch only an exact human approval.
   * @param agent - exact live root Agent in a Daedal preset.
   * @param callId - current tool call identity, used for duplicate delivery protection.
   * @param task - title and complete summary including committed work and remaining steps.
   * @param signal - source operation cancellation; cancellation after dispatch can leave acceptance unknown.
   * @returns explicit rejection, unavailability, successful receipt, or uncertain acceptance with a destination id.
   */
  handoff(agent: Agent, callId: ToolCallId, task: { title: string; task: string }, signal: AbortSignal): Promise<HandoffResult> {
    const operation = this.transfer(agent, callId, task, AbortSignal.any([signal, this.lifetime.signal]))
      .finally(() => { this.pending.delete(operation) })
    this.pending.add(operation)
    return operation
  }

  private async transfer(
    agent: Agent, callId: ToolCallId, task: { title: string; task: string }, signal: AbortSignal,
  ): Promise<HandoffResult> {
    signal.throwIfAborted()
    const preset = daedalPreset.parse(this.ctx.sessionProjections.stateOf(agent.session, 'agentPreset'))
    if (this.ctx.agents.get(agent.id) !== agent || !this.ctx.agents.roots().includes(agent)) {
      throw new Error('Only a live root Daedal session can request host handoff; delegated agents must report the need to their parent.')
    }
    if (isHostExecution(this.ctx, agent)) {
      throw new Error('This session already runs on the host; perform authorized maintenance here.')
    }
    const transport = this.destination
    if (transport === undefined) return { status: 'unavailable', message: 'Host handoff is not configured. Ask the user to open a separate host-maintenance session; do not probe host paths from this session.' }
    const parsed = taskSchema.parse(task)
    const destination = destinationSchema.parse(await this.request(transport, 'GET', signal))
    const request = { sourceSessionId: agent.id, callId, preset, destination, ...parsed }
    const body = JSON.stringify(request)
    if (Buffer.byteLength(body) > this.config.maxBytes) throw new Error('Handoff exceeds the configured byte limit; shorten the task summary.')
    const answer = await this.ctx.userQuestions.ask({ agent, signal, questions: [{
      id: 'daedal-host-handoff', header: 'Host handoff',
      question: `Start a new host-maintenance session on ${destination.name}?`,
      detail: `Destination: ${destination.name}\nAddress: ${destination.url ?? transport.endpoint.origin}\nWorking directory: ${destination.cwd}\nMode: ${preset}\n\nThe new session runs on the host with that profile's permissions. This source session keeps its current access.\n\n# ${parsed.title}\n\n${parsed.task}`,
      options: [{ label: 'Start host session' }, { label: 'Stay here' }],
    }] })
    signal.throwIfAborted()
    if (this.ctx.agents.get(agent.id) !== agent
      || this.ctx.sessionProjections.stateOf(agent.session, 'agentPreset') !== preset) {
      throw new Error('The source session changed during review; request a new handoff.')
    }
    const decision = answer.answers.find(item => item.id === 'daedal-host-handoff')
    if (decision?.selected.length !== 1 || decision.selected[0] !== 'Start host session' || decision.custom?.trim()) {
      return { status: 'declined', message: 'No host session was started. Remain in the current environment.' }
    }
    const sessionId = handoffSessionId(request)
    try {
      const receipt = receiptSchema.parse(await this.request(transport, 'POST', signal, body))
      if (receipt.sessionId !== sessionId) throw new Error('Handoff receipt identity mismatch')
      return { status: 'started', sessionId, destination: destination.name, destinationUrl: destination.url ?? transport.endpoint.origin,
        message: 'Continue in the new host session. Stop host-maintenance work in this source session.' }
    } catch {
      // A failed or cancelled HTTP exchange cannot prove whether the destination admitted the task.
      return { status: 'unknown', sessionId, destinationUrl: destination.url ?? transport.endpoint.origin,
        message: 'Host acceptance is unknown. Inspect this session at the destination before requesting another handoff; do not automatically retry.' }
    }
  }

  private async request(
    transport: { endpoint: URL; token: string }, method: 'GET' | 'POST', signal: AbortSignal, body?: string,
  ): Promise<unknown> {
    const response = await fetch(transport.endpoint, {
      method, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)]),
      headers: { authorization: `Bearer ${transport.token}`, 'content-type': 'application/json' },
      ...body === undefined ? {} : { body },
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Host handoff destination refused the request (HTTP ${response.status}).`)
    }
    if (response.body === null) throw new Error('Host handoff destination returned no response body')
    const chunks: Uint8Array[] = []
    let length = 0
    for await (const chunk of response.body) {
      length += chunk.byteLength
      if (length > this.config.maxBytes) throw new Error('Host handoff response exceeds the configured byte limit')
      chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  }
}

export default DaedalHandoff
