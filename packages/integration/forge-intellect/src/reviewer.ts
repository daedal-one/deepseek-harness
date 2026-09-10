/** Fresh tool-free Harness review sessions for the native coordinator. */
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type ModelSelection } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as Persona from '@deepseek-ai/dsh-persona'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { reviewerContract, REVIEW_PROMPT, type Packet } from './contract.ts'

/** Retain exact entrypoint bytes with the review; the native status command checks them. */
async function moduleIdentities(): Promise<Record<string, { path: string; sha256: string }>> {
  const require = createRequire(import.meta.url)
  const paths: Record<string, string> = Object.fromEntries(['@deepseek-ai/dsh-agent-loop', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-llm-pi-ai', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-tools'].map(name => [name, require.resolve(name)]))
  paths['deadal-intellect-reviewer'] = fileURLToPath(import.meta.url)
  return Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, { path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') }] as const)))
}

/** Own the entire fresh-agent turn; no caller can enqueue unrelated work into this interval. */
async function turn(ctx: Context, agent: Agent, message: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const abort = () => { agent.cancel({ kind: 'parent' }); cleanup(); reject(new Error('Verification reviewer cancelled')) }
    const dispose = ctx.on('agent/status', ({ agent: current, status }) => {
      if (current === agent && status === 'idle') { cleanup(); resolve() }
    })
    const cleanup = () => { dispose(); signal.removeEventListener('abort', abort) }
    signal.addEventListener('abort', abort, { once: true })
    try { agent.followup(createUserMessage({ content: [{ type: 'text', text: message }], source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-forge-intellect' } })) }
    catch (error) { cleanup(); reject(error instanceof Error ? error : new Error('Reviewer could not start')) }
  })
}

/** Run one planning/review packet, with at most two structural corrections and durable raw sessions.
 * @param ctx - unscoped host context owning reviewer creation.
 * @param packet - authenticated native packet.
 * @param selection - approved provider and model route.
 * @param maxTokens - output limit for each request.
 * @param directory - native evidence directory receiving raw session records.
 * @param signal - complete reviewer lifetime cancellation.
 * @returns Native protocol envelope with grounded citations and runtime identity.
 */
export async function reviewPacket(
  ctx: Context, packet: Packet, selection: ModelSelection, maxTokens: number, directory: string, signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const contract = reviewerContract(packet)
  const sessionId = SessionId(`intellect-${packet.role}-${packet.stage}-${randomUUID()}`)
  const modules = await moduleIdentities()
  const handle = await ctx.agents.create({
    sessionId, signal,
    agentOptions: { ...selection, maxTokens },
    meta: { cwd: directory, origin: 'subagent' },
    setup: async (agentCtx) => {
      agentCtx.tools.restrict({ allow: [] })
      agentCtx.tools.guard(() => 'Verification reviewers cannot execute tools')
      await agentCtx.plugin(Persona, { prefix: REVIEW_PROMPT, complete: true, includeRuntimeContext: false })
      installModelSelection(agentCtx, { current: selection, assembled: undefined })
    },
  })
  const agent = handle.agent
  let pending = Promise.resolve()
  const persist = () => {
    const events = JSON.stringify(agent.session.snapshotEvents())
    pending = pending.then(() => writeFile(join(directory, 'session-events.json'), events, { mode: 0o600 }))
    return pending
  }
  const timer = setInterval(() => { void persist().catch(() => {}) }, 2000)
  timer.unref()
  const corrections: string[] = []
  let message = `Perform the ${packet.stage} stage as ${packet.role}. Return one response_contract data object. The request metadata stage and context are not response fields; never echo them.\n${JSON.stringify(contract.model)}`
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      await turn(ctx, agent, message, signal)
      await persist()
      const events = agent.session.snapshotEvents()
      const last = events.findLast(e => e.type === 'assistant/message')
      const end = events.findLast(e => e.type === 'turn/end')
      if (end?.data.reason.kind !== 'completed') throw new Error('Reviewer did not complete; raw session retained')
      const text = last?.data.message.content.filter(b => b.type === 'text').map(b => b.text).join('') ?? ''
      try {
        const { response, citations } = contract.resolve(text)
        return {
          schema: packet.schema, finish_reason: 'completed',
          identity: { adapter: 'deadal-intellect/v1', session_id: sessionId, ...selection, max_tokens: maxTokens, modules, protocol_corrections: corrections, resolved_citations: citations, usage: events.filter(e => e.type === 'assistant/message').map(e => e.data.usage).filter(Boolean) },
          response,
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Invalid response'
        corrections.push(reason)
        if (attempt === 2) throw new Error(`${packet.role} ${packet.stage} reviewer returned an invalid response after 3 attempts: ${reason}`)
        message = `Your response failed a deterministic protocol check: ${reason}. Return the complete corrected object using only the property names in the response contract below. Delete unexpected fields, especially the request metadata stage and context; do not rename or retain them. Preserve your substantive judgment and concerns; correct only structure or references. Do not invent evidence. If evidence cannot support a claim, mark it inconclusive. Response contract: ${JSON.stringify(contract.model.response_contract)}`
      }
    }
    throw new Error('Reviewer exhausted protocol corrections')
  } finally {
    clearInterval(timer)
    await handle.dispose()
    await persist()
  }
}
