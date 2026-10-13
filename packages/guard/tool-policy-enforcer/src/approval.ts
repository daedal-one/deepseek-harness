/** Exact-call user approval derived from the current turn's durable audit. @module */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'

interface RecordedCall {
  id: ToolExecution['callId']
  name: string
  arguments: unknown
  index: number
}

function turnEvents(session: Session): readonly SessionEvent[] {
  const events = session.snapshotEvents()
  const index = events.findLastIndex(event => event.type === 'turn/start' || event.type === 'turn/end')
  return events[index]?.type === 'turn/start' ? events.slice(index + 1) : []
}

function parseArguments(raw: string): unknown {
  try { return raw.length === 0 ? {} : JSON.parse(raw) }
  catch { return raw } // Malformed model JSON cannot name an approval request.
}

function callsIn(events: readonly SessionEvent[]): RecordedCall[] {
  return events.flatMap((event, index) => {
    if (event.type === 'tool/call') {
      return [{ id: event.data.callId, name: event.data.name, arguments: parseArguments(event.data.arguments), index }]
    }
    if (event.type === 'tool/ptc-dispatch-start') {
      return [{ id: event.data.subCallId, name: event.data.name, arguments: event.data.arguments, index }]
    }
    return []
  })
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sameCall(left: RecordedCall, right: Pick<RecordedCall, 'name' | 'arguments'>): boolean {
  return left.name === right.name && canonicalJson(left.arguments) === canonicalJson(right.arguments)
}

function targetOf(request: RecordedCall, calls: readonly RecordedCall[]): RecordedCall | undefined {
  if (request.name !== 'request_tool_approval' || request.arguments === null || typeof request.arguments !== 'object') return undefined
  const id = (request.arguments as Record<string, unknown>).call_id
  return calls.find(call => call.index < request.index && call.id === id)
}

function resultIndex(events: readonly SessionEvent[], id: RecordedCall['id'], isError: boolean): number {
  return events.findIndex((event) => {
    if (event.type === 'tool/ptc-dispatch') return event.data.subCallId === id && event.data.isError === isError
    if (event.type !== 'tool/result') return false
    return event.data.message.content.some(block => block.toolCallId === id && block.isError === isError)
  })
}

function approvalFor(events: readonly SessionEvent[], request: RecordedCall) {
  const asked = events.find(event => event.type === 'approval/asked' && event.data.callId === request.id)
  if (asked?.type !== 'approval/asked') return undefined
  const decided = events.find(event => event.type === 'approval/decided' && event.data.id === asked.data.id)
  return { asked, outcome: decided?.type === 'approval/decided' ? decided.data.outcome : undefined }
}

/**
 * Match a completed grant to the first subsequent exact call in its open turn.
 * The logged call order consumes the grant before asynchronous policy evaluation,
 * including when several matching calls share one model response.
 * @param session - the initiating Session containing the approval audit.
 * @param exec - current execution identity and arguments.
 * @returns whether this call owns a successful explicit approval.
 */
export function hasApprovalGrant(session: Session, exec: Pick<ToolExecution, 'name' | 'arguments' | 'callId'>): boolean {
  const events = turnEvents(session)
  const calls = callsIn(events)
  return calls.some((request) => {
    const target = targetOf(request, calls)
    if (target === undefined || !sameCall(target, exec)) return false
    const approval = approvalFor(events, request)
    if (approval?.outcome !== 'allowed-once' || approval.asked.data.toolName !== target.name) return false
    const completed = resultIndex(events, request.id, false)
    if (completed < 0) return false
    return calls.find(call => call.index > completed && sameCall(call, target))?.id === exec.callId
  })
}

/**
 * Register direct human escalation for a completed automatic policy denial.
 * The approval audit and successful tool result jointly issue the exact-call grant.
 * @param ctx - tool registry and optional approval service.
 */
export function installApprovalTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'request_tool_approval',
    description: 'Request user approval for a call denied by automatic policy review. Supply the denied call_id and explain why the action is necessary. This tool does not execute the action. After approval succeeds, retry the exact tool and arguments once in this turn. Repeating denied calls never triggers approval. A user rejection is final for that action in this turn; do not work around it. Deterministic policy denials cannot be approved.',
    parameters: {
      call_id: { type: 'string', required: true, description: 'The denied call_id supplied by automatic policy review in this turn.' },
      justification: { type: 'string', required: true, description: 'Explain why this exact action is necessary for the user’s task.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('tool approval requires an initiating session')
      if (args.justification.trim().length === 0) throw new Error('tool approval requires a non-empty justification')
      const events = turnEvents(exec.agent.session)
      const calls = callsIn(events)
      const target = calls.find(call => call.id === args.call_id)
      const decision = events.findLast(event => event.type === 'tool-policy/decision'
        && event.data.callId === args.call_id && event.data.stage === 'effective')
      if (target === undefined || target.name === 'request_tool_approval'
        || decision?.type !== 'tool-policy/decision' || decision.data.policyDecision !== 'ask'
        || decision.data.effectiveDecision !== 'deny' || resultIndex(events, target.id, true) < 0) {
        throw new Error('call_id must name a completed automatic policy denial in this session’s current turn')
      }
      if (ctx.tools.get(target.name, exec.agent) === undefined) throw new Error('the denied tool is no longer available')
      for (const request of calls) {
        const prior = targetOf(request, calls)
        if (prior === undefined || !sameCall(prior, target)) continue
        const approval = approvalFor(events, request)
        if (approval === undefined) continue
        if (approval.outcome === 'rejected') throw new Error('the user rejected this action; do not request it again in this turn')
        if (prior.id === target.id || approval.outcome === undefined) throw new Error('approval was already requested for this call')
      }
      const approval = ctx.get('approval')
      if (approval === undefined) throw new Error('no approval service is available; stop and explain the blocked action')
      const outcome = await approval.request({
        agent: exec.agent, callId: exec.callId, toolName: target.name,
        reason: `Approve one exact ${target.name} call: ${JSON.stringify(target.arguments)}\nAutomatic review: ${decision.data.reason}\nJustification: ${args.justification}`,
        signal: exec.signal,
      })
      if (outcome !== 'allowed-once') throw new Error(`tool approval ${outcome}; do not execute the denied action`)
      return 'Approved once. Retry the exact denied tool and arguments in this turn. This approval does not authorize changed arguments or additional executions.'
    },
  }))
}
