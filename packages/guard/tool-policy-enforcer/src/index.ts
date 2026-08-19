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
}

const enforcementCondition = z.object({
  sandboxModes: z.array(z.union(SANDBOX_MODES as SandboxMode[])).min(1),
  approvalPolicies: z.array(z.union(APPROVAL_POLICIES as ApprovalPolicy[])).min(1),
})

/** Runtime schema for the stateless enforcer. */
export const Config: z<Config> = z.object({
  // The union wrapper keeps an omitted property absent instead of constructing
  // the nested object's empty array defaults.
  enforceWhen: z.union([enforcementCondition]),
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

function appendDecision(exec: ToolExecution, opinion: ToolPolicyOpinion, stage: 'provider' | 'effective', effective: ToolPolicyOpinion['decision']): void {
  exec.agent?.session.append('tool-policy/decision', {
    turn: currentTurn(exec), callId: exec.callId, toolName: exec.name, stage,
    policyDecision: opinion.decision, effectiveDecision: effective,
    providerId: opinion.providerId, risk: opinion.risk,
    categories: [...opinion.categories], reason: opinion.reason,
  })
}

/** Install the policy consumer on `tools/pre-execute`. */
export function apply(ctx: Context, config: Config = {}): void {
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
    appendDecision(exec, verdict, 'effective', 'ask')
    return { kind: 'ask', reason: verdict.reason }
  })
  ctx.effect(() => () => {
    lifetime.abort(new Error('tool-policy enforcer disposed'))
    disposePrewarm()
    dispose()
  }, 'tool-policy-enforcer listeners')
}
