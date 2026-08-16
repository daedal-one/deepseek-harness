/** Delayed one-shot enforcement of tool-policy verdicts. @module @deepseek-ai/dsh-tool-policy-enforcer */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ToolPolicyProviderId, type ToolPolicyOpinion, type ToolPolicyVerdict } from '@deepseek-ai/dsh-tool-policy'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

export const name = 'tool-policy-enforcer'
export const inject = ['tools', 'toolPolicy']

/** Bounds for delayed approval opportunities. */
export interface Config {
  /** Identical ask attempts required before human approval is requested. */
  readonly threshold?: number
  /** Inactivity lifetime of an unspent or spent key. */
  readonly ttlMs?: number
  /** Maximum retained exact-call keys across sessions. */
  readonly maxEntries?: number
}

/** Runtime schema for delayed-state bounds. */
export const Config: z<Config> = z.object({
  threshold: z.number().step(1).min(2).default(2),
  ttlMs: z.number().step(1).min(1).default(300_000),
  maxEntries: z.number().step(1).min(1).default(2_000),
})

interface ResolvedConfig { threshold: number; ttlMs: number; maxEntries: number }
interface Entry { attempts: number; spent: boolean; touchedAt: number }
/** State transition for one exact delayed-approval key. */
export interface AskAttempt {
  /** Identical attempt number observed for the key. */
  readonly number: number
  /** Configured attempt that spends the opportunity. */
  readonly threshold: number
  /** Whether the one-shot opportunity has been consumed. */
  readonly spent: boolean
  /** Whether this transition may enter the approval service. */
  readonly ask: boolean
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

/** Exact delayed-approval state keyed by session, durable turn, tool, and canonical arguments. */
export class DelayedAskState {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly config: ResolvedConfig, private readonly now: () => number = Date.now) {}

  /**
   * Advance one exact ask and spend its approval opportunity before returning it.
   * @param sessionId - stable owning session identity.
   * @param turn - current durable turn number.
   * @param toolName - exact registered tool name.
   * @param args - exact JSON arguments, canonicalized for key ordering.
   * @returns the attempt state after this transition.
   */
  advance(sessionId: string, turn: number, toolName: string, args: unknown): AskAttempt {
    const now = this.now()
    this.prune(now)
    const key = JSON.stringify([sessionId, turn, toolName, canonicalJson(args)])
    const existing = this.entries.get(key)
    if (existing?.spent) {
      existing.touchedAt = now
      return { number: existing.attempts, threshold: this.config.threshold, spent: true, ask: false }
    }
    const attempts = (existing?.attempts ?? 0) + 1
    const spent = attempts >= this.config.threshold
    this.entries.delete(key)
    this.entries.set(key, { attempts, spent, touchedAt: now })
    this.prune(now)
    return { number: attempts, threshold: this.config.threshold, spent, ask: spent }
  }

  /** Drop all process-local opportunities during plugin disposal. */
  clear(): void { this.entries.clear() }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.touchedAt >= this.config.ttlMs) this.entries.delete(key)
    }
    while (this.entries.size > this.config.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }
}

function currentTurn(exec: ToolExecution): number {
  const boundary = exec.agent?.session.events.findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
  return boundary?.type === 'turn/start' ? boundary.data.turn : 0
}

function appendDecision(exec: ToolExecution, opinion: ToolPolicyOpinion, stage: 'provider' | 'effective', effective: ToolPolicyOpinion['decision'], attempt?: AskAttempt): void {
  exec.agent?.session.append('tool-policy/decision', {
    turn: currentTurn(exec), callId: exec.callId, toolName: exec.name, stage,
    policyDecision: opinion.decision, effectiveDecision: effective,
    providerId: opinion.providerId, risk: opinion.risk,
    categories: [...opinion.categories], reason: opinion.reason,
    ...(attempt === undefined ? {} : { attempt: { number: attempt.number, threshold: attempt.threshold, spent: attempt.spent } }),
  })
}

function retryReason(attempt: AskAttempt): string {
  return `Policy requires approval. Retry this exact tool call without changing its arguments (attempt ${attempt.number}/${attempt.threshold}).`
}

function spentReason(): string {
  return 'Policy approval opportunity was already spent for this exact tool call in the current turn.'
}

/** Install the policy consumer on `tools/pre-execute`. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved: ResolvedConfig = {
    threshold: config.threshold ?? 2,
    ttlMs: config.ttlMs ?? 300_000,
    maxEntries: config.maxEntries ?? 2_000,
  }
  const state = new DelayedAskState(resolved)
  const dispose = ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (exec.agent === undefined) return next()
    let verdict: ToolPolicyVerdict | undefined
    try {
      verdict = await ctx.toolPolicy.evaluate({
        callId: exec.callId, toolName: exec.name, arguments: exec.arguments,
        agent: exec.agent, signal: exec.signal,
      })
    } catch (_error: unknown) {
      if (exec.signal.aborted) throw exec.signal.reason
      verdict = {
        providerId: ToolPolicyProviderId('tool-policy'), decision: 'ask', risk: 100,
        categories: ['unavailable'], reason: 'tool policy is unavailable', opinions: [],
      }
    }
    if (verdict === undefined) return next()
    const providerOpinions = verdict.opinions.length === 0 ? [verdict] : verdict.opinions
    for (const providerOpinion of providerOpinions) appendDecision(exec, providerOpinion, 'provider', providerOpinion.decision)
    if (verdict.decision === 'allow') {
      appendDecision(exec, verdict, 'effective', 'allow')
      return next()
    }
    if (verdict.decision === 'deny') {
      appendDecision(exec, verdict, 'effective', 'deny')
      return { kind: 'deny', reason: verdict.reason }
    }
    const attempt = state.advance(String(exec.agent.session.id), currentTurn(exec), exec.name, exec.arguments)
    if (attempt.ask) {
      appendDecision(exec, verdict, 'effective', 'ask', attempt)
      return { kind: 'ask', reason: verdict.reason }
    }
    appendDecision(exec, verdict, 'effective', 'deny', attempt)
    return { kind: 'deny', reason: attempt.spent ? spentReason() : retryReason(attempt) }
  })
  ctx.effect(() => () => {
    dispose()
    state.clear()
  }, 'tool-policy-enforcer state and listener')
}
