/** Enforcement of tool-policy verdicts at tool pre-execution. @module @deepseek-ai/dsh-tool-policy-enforcer */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ToolPolicyProviderId, type ToolPolicyOpinion, type ToolPolicyVerdict } from '@deepseek-ai/dsh-tool-policy'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

export const name = 'tool-policy-enforcer'
export const inject = ['tools', 'toolPolicy']

/** Tool-policy enforcer configuration. */
export interface Config {}

/** Runtime schema for the stateless enforcer. */
export const Config: z<Config> = z.object({})

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
export function apply(ctx: Context): void {
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
    appendDecision(exec, verdict, 'effective', 'ask')
    return { kind: 'ask', reason: verdict.reason }
  })
  ctx.effect(() => dispose, 'tool-policy-enforcer listener')
}
