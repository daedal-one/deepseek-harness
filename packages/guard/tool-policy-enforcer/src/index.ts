/** Enforcement of tool-policy verdicts at tool pre-execution. @module @deepseek-ai/dsh-tool-policy-enforcer */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { SANDBOX_MODES, effectiveSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { ToolPolicyProviderId, type ToolPolicyOpinion, type ToolPolicyVerdict } from '@deepseek-ai/dsh-tool-policy'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { ApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { APPROVAL_POLICIES, effectiveApprovalPolicy } from '@deepseek-ai/dsh-user-approval'

export const name = 'tool-policy-enforcer'
export const inject = ['tools', 'toolPolicy']

/** Effective permission values for which the enforcer evaluates policy. */
export interface EnforcementCondition {
  /** Sandbox modes that activate policy evaluation when configured. */
  readonly sandboxModes?: readonly SandboxMode[]
  /** Approval policies that activate policy evaluation when configured. */
  readonly approvalPolicies?: readonly ApprovalPolicy[]
}

/** Tool-policy enforcer configuration. */
export interface Config {
  /** Optional conjunction over the session's durable permission values. */
  readonly enforceWhen?: EnforcementCondition
  /** Consecutive identical ask verdicts required before human approval. */
  readonly approvalThreshold?: number
}

const enforcementCondition = z.object({
  sandboxModes: z.array(z.union(SANDBOX_MODES as SandboxMode[])).min(1),
  approvalPolicies: z.array(z.union(APPROVAL_POLICIES as ApprovalPolicy[])).min(1),
})

/** Runtime schema for the event-derived enforcer. */
export const Config: z<Config> = z.object({
  // The union wrapper keeps an omitted property absent instead of constructing
  // the nested object's empty array defaults.
  enforceWhen: z.union([enforcementCondition]),
  approvalThreshold: z.number().step(1).min(2).default(3),
}) as z<Config>

/**
 * Decide whether one session matches a configured enforcement condition.
 * Missing durable values keep enforcement active because they cannot establish
 * a configured bypass. An omitted condition preserves unconditional behavior.
 * @param events - session events containing the effective permission values.
 * @param condition - optional deployment-owned activation restriction.
 * @returns whether the tool-policy providers must evaluate the call.
 */
export function shouldEnforce(
  events: readonly SessionEvent[],
  condition: EnforcementCondition | undefined,
): boolean {
  if (condition === undefined) return true
  const sandbox = effectiveSandboxMode(events)
  const approval = effectiveApprovalPolicy(events)
  if (condition.sandboxModes !== undefined) {
    if (sandbox === undefined) return true
    if (!condition.sandboxModes.includes(sandbox)) return false
  }
  if (condition.approvalPolicies !== undefined) {
    if (approval === undefined) return true
    if (!condition.approvalPolicies.includes(approval)) return false
  }
  return true
}

function currentTurn(exec: ToolExecution): number {
  const boundary = exec.agent?.session.events.findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
  return boundary?.type === 'turn/start' ? boundary.data.turn : 0
}

function appendDecision(
  exec: ToolExecution,
  opinion: ToolPolicyOpinion,
  stage: 'provider' | 'effective',
  effective: ToolPolicyOpinion['decision'],
  reason = opinion.reason,
): void {
  exec.agent?.session.append('tool-policy/decision', {
    turn: currentTurn(exec), callId: exec.callId, toolName: exec.name, stage,
    policyDecision: opinion.decision, effectiveDecision: effective,
    providerId: opinion.providerId, risk: opinion.risk,
    categories: [...opinion.categories], reason,
  })
}

/**
 * Canonical JSON identity for one parsed tool-argument value. ToolRuntime has
 * already enforced lossless JSON; malformed model argument text is a string.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) as string
}

/** Match the agent loop's raw-argument parsing for durable prior calls. */
function parseArguments(raw: string): unknown {
  try {
    return raw.length === 0 ? {} : JSON.parse(raw)
  } catch {
    return raw
  }
}

function callKey(toolName: string, argumentsValue: unknown): string {
  return JSON.stringify([toolName, canonicalJson(argumentsValue)])
}

/** Count the uninterrupted prior ask denials for this exact call in the open turn. */
function consecutiveAskDenials(exec: ToolExecution): number {
  const events = exec.agent?.session.events ?? []
  const turn = currentTurn(exec)
  const key = callKey(exec.name, exec.arguments)
  const currentCallIndex = events.findLastIndex(event => event.type === 'tool/call' && event.data.callId === exec.callId)
  const before = currentCallIndex < 0 ? events.length : currentCallIndex
  const decisions = new Map<ToolExecution['callId'], SessionEvent<'tool-policy/decision'>>()
  const failedResults = new Map<ToolExecution['callId'], boolean>()
  let count = 0
  for (let index = before - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'turn/start' || event?.type === 'turn/end') break
    if (event?.type === 'tool-policy/decision' && event.data.stage === 'effective') {
      if (!decisions.has(event.data.callId)) decisions.set(event.data.callId, event)
      continue
    }
    if (event?.type === 'tool/result') {
      const result = event.data.message.content[0]
      if (result?.type === 'tool-result' && !failedResults.has(result.toolCallId)) {
        failedResults.set(result.toolCallId, result.isError === true)
      }
      continue
    }
    if (event?.type !== 'tool/call') continue
    if (event.data.turn !== turn || callKey(event.data.name, parseArguments(event.data.arguments)) !== key) break
    const decision = decisions.get(event.data.callId)
    if (decision?.data.policyDecision !== 'ask') break
    if (decision.data.effectiveDecision === 'deny') {
      count += 1
    } else if (decision.data.effectiveDecision === 'ask'
      && failedResults.get(event.data.callId) === true) {
      count += 1
    } else {
      break
    }
    decisions.delete(event.data.callId)
    failedResults.delete(event.data.callId)
  }
  return count
}

function deferredReason(reason: string, attempt: number, threshold: number): string {
  return `Automatic policy review denied this call without asking the user (attempt ${attempt}/${threshold}): ${reason}. Change approach or retry this exact tool call; attempt ${threshold} asks the user.`
}

/** Install the policy consumer on `tools/pre-execute`. */
export function apply(ctx: Context, config: Config = {}): void {
  const approvalThreshold = config.approvalThreshold ?? 3
  const lifetime = new AbortController()
  const disposePrewarm = ctx.on('session/event', (session, event) => {
    const directUser = event.type === 'user/message' && event.data.source.kind === 'user'
    const permissionChanged = event.type === 'sandbox/mode'
      || event.type === 'approval/policy'
    if (!directUser && !permissionChanged) return
    queueMicrotask(() => {
      if (lifetime.signal.aborted || !shouldEnforce(session.events, config.enforceWhen)) return
      void ctx.toolPolicy.prewarm({ session, signal: lifetime.signal }).catch((_prewarmFailure: unknown) => {
        // Evaluation reports missing preparation through its ordinary fail-closed verdict.
      })
    })
  })
  const dispose = ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (exec.agent === undefined) return next()
    if (!shouldEnforce(exec.agent.session.events, config.enforceWhen)) return next()
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
    const attempt = consecutiveAskDenials(exec) + 1
    if (attempt < approvalThreshold) {
      const reason = deferredReason(verdict.reason, attempt, approvalThreshold)
      appendDecision(exec, verdict, 'effective', 'deny', reason)
      return { kind: 'deny', reason }
    }
    appendDecision(exec, verdict, 'effective', 'ask')
    return { kind: 'ask', reason: verdict.reason }
  })
  ctx.effect(() => () => {
    lifetime.abort(new Error('tool-policy enforcer disposed'))
    disposePrewarm()
    dispose()
  }, 'tool-policy-enforcer listeners')
}
