/** Privileged reviewer tools for durable memory. @module @deepseek-ai/dsh-tool-memory-reviewer */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MemoryId } from '@deepseek-ai/dsh-memory'
import type { MemoryScope } from '@deepseek-ai/dsh-memory'
import { foldSubagentDescriptor, SubagentPrincipal } from '@deepseek-ai/dsh-subagent'
import { snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-user-approval'

export const name = 'tool-memory-reviewer'
export const inject = ['subagents']
/** Trusted child principal allowed to receive reviewer prompt and tools. */
export interface Config {
  /** Config-owned durable child principal authorized to review memory. */
  reviewerPrincipal?: string
}
export const Config: z<Config> = z.object({ reviewerPrincipal: z.string().default('memory-reviewer') })
const output = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] }
function json(value: unknown): JsonValue { const result = snapshotJsonValue(value); if (result === undefined) throw new Error('memory reviewer result is not lossless JSON'); return result as JsonValue }

function scopeOf(value: 'project' | 'global', exec: ToolRunContext): MemoryScope {
  if (value === 'global') return { kind: 'global' }
  const project = exec.agent?.session.header.cwd
  if (project === undefined) throw new Error('project memory requires a session cwd')
  return { kind: 'project', project }
}
/**
 * Reject an execution whose durable child principal differs from configuration.
 * @param config - config-owned required principal.
 * @param exec - agent-owned tool execution.
 */
export function assertMemoryReviewerPrincipal(config: Config, exec: ToolRunContext): void {
  const session = exec.agent?.session
  if (session === undefined) throw new Error('memory reviewer tools require an agent-owned execution')
  const descriptor = foldSubagentDescriptor(session.snapshotEvents())
  if (descriptor?.principal !== (config.reviewerPrincipal ?? 'memory-reviewer')) {
    throw new Error('memory reviewer authorization denied this execution')
  }
}
/**
 * Require a one-time approval for one global reviewer mutation.
 * @param ctx - child context with the optional approval service.
 * @param exec - exact tool execution and calling agent.
 * @param scope - mutation scope.
 * @param action - human-readable mutation name.
 */
export async function approveGlobalReviewerMutation(ctx: Context, exec: ToolRunContext, scope: MemoryScope, action: string): Promise<void> {
  if (scope.kind !== 'global') return
  const approval = ctx.get('approval')
  if (approval === undefined || exec.agent === undefined) throw new Error(`global memory ${action} requires an available approval channel`)
  const result = await approval.request({ agent: exec.agent, toolName: exec.name, callId: exec.callId, reason: `Change global durable memory: ${action}`, signal: exec.signal })
  if (result !== 'allowed-once') throw new Error(`global memory ${action} was not approved (${result})`)
}

/** Register the reviewer capability only inside matching principal children. */
export function apply(ctx: Context, config: Config): void {
  const reviewerPrincipal = config.reviewerPrincipal ?? 'memory-reviewer'
  if (reviewerPrincipal.trim().length === 0) {
    throw new Error('tool-memory-reviewer: reviewerPrincipal must be non-empty')
  }
  const resolved: Config = { reviewerPrincipal }
  ctx.subagents.registerPrincipalSetup(
    SubagentPrincipal(reviewerPrincipal),
    childCtx => installReviewerToolsAndPrompt(childCtx, resolved),
  )
}

/**
 * Install all reviewer prompt/tool contributions into one trusted child scope.
 * @param ctx - matching principal child's scoped context.
 * @param config - resolved reviewer principal policy.
 * @returns one disposer revoking the whole capability set.
 */
export function installReviewerToolsAndPrompt(ctx: Context, config: Config): () => void {
  const disposers: Array<() => void> = []
  disposers.push(ctx.systemPrompt.section({ name: 'tool:memory-reviewer', order: 114, text: 'Reviewer-only memory controls list pending proposals and challenges, accept or reject them, supersede active facts, and delete exact revisions. Verify evidence, contradictions, scope, temporal validity, and trust before changing state. Global changes still require one-time human approval.' }))
  disposers.push(ctx.tools.register(defineTool({
    name: 'memory_list_pending', description: 'List proposed and challenged memories awaiting reviewer action in exactly one scope.',
    parameters: { scope: { type: 'string', required: true, enum: ['project', 'global'] }, text: { type: 'string' }, limit: { type: 'number' } }, output,
    async execute(args, exec) { assertMemoryReviewerPrincipal(config, exec); return json(await ctx.memory.query({ scope: scopeOf(args.scope, exec), text: args.text ?? '', statuses: ['proposed', 'challenged'], ...args.limit === undefined ? {} : { limit: args.limit } })) },
    presentCall: args => ({ card: 'generic', title: 'List pending memory', kind: 'read', ...args.text === undefined ? {} : { rawInput: args.text } }),
  })))
  disposers.push(ctx.tools.register(defineTool({
    name: 'memory_review', description: 'Accept or reject one exact proposed or challenged memory revision.',
    parameters: { scope: { type: 'string', required: true, enum: ['project', 'global'] }, id: { type: 'string', required: true }, revision: { type: 'number', required: true }, decision: { type: 'string', required: true, enum: ['accept', 'reject'] }, trust: { type: 'number' } }, output,
    async execute(args, exec) { assertMemoryReviewerPrincipal(config, exec); const scope = scopeOf(args.scope, exec); await approveGlobalReviewerMutation(ctx, exec, scope, 'review'); return json(await ctx.memory.review({ ref: { scope, id: MemoryId(args.id), revision: args.revision }, decision: args.decision, ...args.trust === undefined ? {} : { trust: { score: args.trust, source: 'reviewer' } } })) },
    presentCall: args => ({ card: 'generic', title: 'Review memory', kind: 'other', rawInput: args.id }),
  })))
  disposers.push(ctx.tools.register(defineTool({
    name: 'memory_supersede', description: 'Atomically replace one exact active or challenged memory with a reviewed successor in the same scope.',
    parameters: { scope: { type: 'string', required: true, enum: ['project', 'global'] }, id: { type: 'string', required: true }, revision: { type: 'number', required: true }, statement: { type: 'string', required: true }, evidence: { type: 'array', required: true, items: { type: 'string' } }, trust: { type: 'number', required: true }, valid_until: { type: 'number' }, contradicts: { type: 'array', items: { type: 'string' } } }, output,
    async execute(args, exec) { assertMemoryReviewerPrincipal(config, exec); const scope = scopeOf(args.scope, exec); await approveGlobalReviewerMutation(ctx, exec, scope, 'supersession'); return json(await ctx.memory.supersede({ ref: { scope, id: MemoryId(args.id), revision: args.revision }, replacement: { scope, statement: args.statement, evidence: args.evidence.map(ref => ({ kind: 'agent' as const, ref })), trust: { score: args.trust, source: 'reviewer' }, ...args.valid_until === undefined ? {} : { validity: { validUntil: args.valid_until } }, ...args.contradicts === undefined ? {} : { contradicts: args.contradicts.map(MemoryId) } } })) },
    presentCall: args => ({ card: 'generic', title: 'Supersede memory', kind: 'other', rawInput: args.statement }),
  })))
  disposers.push(ctx.tools.register(defineTool({
    name: 'memory_delete', description: 'Permanently delete one exact memory revision.',
    parameters: { scope: { type: 'string', required: true, enum: ['project', 'global'] }, id: { type: 'string', required: true }, revision: { type: 'number', required: true } }, output,
    async execute(args, exec) { assertMemoryReviewerPrincipal(config, exec); const scope = scopeOf(args.scope, exec); await approveGlobalReviewerMutation(ctx, exec, scope, 'deletion'); return json({ deleted: await ctx.memory.delete({ scope, id: MemoryId(args.id), revision: args.revision }) }) },
    presentCall: args => ({ card: 'generic', title: 'Delete memory', kind: 'other', rawInput: args.id }),
  })))
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
