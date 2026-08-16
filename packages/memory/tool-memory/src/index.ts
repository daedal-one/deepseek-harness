/** Ordinary model-facing tools for reviewed memory. @module @deepseek-ai/dsh-tool-memory */
import type { Context } from '@deepseek-ai/cordis'
import { MemoryId } from '@deepseek-ai/dsh-memory'
import type { MemoryRecord, MemoryScope } from '@deepseek-ai/dsh-memory'
import { snapshotJsonValue } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-user-approval'

export const name = 'tool-memory'
export const inject = ['memory', 'tools', 'systemPrompt']

const output = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] }

function scopeOf(value: 'project' | 'global', exec: ToolRunContext): MemoryScope {
  if (value === 'global') return { kind: 'global' }
  const project = exec.agent?.session.header.cwd
  if (project === undefined) throw new Error('project memory requires a session cwd')
  return { kind: 'project', project }
}

/**
 * Require a one-time approval for one global ordinary-tool mutation.
 * @param ctx - context with the optional approval service.
 * @param exec - exact tool execution and calling agent.
 * @param scope - mutation scope.
 * @param action - human-readable mutation name.
 */
export async function approveGlobalMemoryMutation(ctx: Context, exec: ToolRunContext, scope: MemoryScope, action: string): Promise<void> {
  if (scope.kind !== 'global') return
  const approval = ctx.get('approval')
  if (approval === undefined || exec.agent === undefined) throw new Error(`global memory ${action} requires an available approval channel`)
  const result = await approval.request({ agent: exec.agent, toolName: exec.name, callId: exec.callId, reason: `Write global durable memory: ${action}`, signal: exec.signal })
  if (result !== 'allowed-once') throw new Error(`global memory ${action} was not approved (${result})`)
}

function json(value: unknown): JsonValue { const result = snapshotJsonValue(value); if (result === undefined) throw new Error('memory result is not lossless JSON'); return result as JsonValue }
function present(record: MemoryRecord): JsonValue { return json(record) }

/** Register scoped query, read, proposal, challenge, and checkpoint tools. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({ name: 'tool:memory', order: 113, text: 'Use memory_query before relying on prior facts. Project memory is isolated by the current session workspace. Global proposals and other global writes always require one-time human approval. Proposals are unreviewed until a trusted reviewer accepts them; preserve evidence and link contradictions.' })

  ctx.tools.register(defineTool({
    name: 'memory_query', description: 'Search reviewed durable memory in exactly one scope.',
    parameters: { scope: { type: 'string', required: true, enum: ['project', 'global'] }, text: { type: 'string', required: true }, limit: { type: 'number' } }, output,
    async execute(args, exec) {
      return json(await ctx.memory.query({
        scope: scopeOf(args.scope, exec),
        text: args.text,
        ...args.limit === undefined ? {} : { limit: args.limit },
      }))
    },
    presentCall: args => ({ card: 'generic', title: 'Search memory', kind: 'read', rawInput: args.text }),
  }))
  ctx.tools.register(defineTool({
    name: 'memory_get', description: 'Read one durable memory by exact id inside one scope.',
    parameters: { scope: { type: 'string', required: true, enum: ['project', 'global'] }, id: { type: 'string', required: true } }, output,
    async execute(args, exec) { return json((await ctx.memory.get(scopeOf(args.scope, exec), MemoryId(args.id))) ?? null) },
    presentCall: args => ({ card: 'generic', title: 'Read memory', kind: 'read', rawInput: args.id }),
  }))
  ctx.tools.register(defineTool({
    name: 'memory_propose', description: 'Propose an evidence-backed durable memory. The proposal is not active until reviewed.',
    parameters: { scope: { type: 'string', required: true, enum: ['project', 'global'] }, statement: { type: 'string', required: true }, evidence: { type: 'array', required: true, items: { type: 'string' } }, trust: { type: 'number', required: true }, valid_until: { type: 'number' }, contradicts: { type: 'array', items: { type: 'string' } } }, output,
    async execute(args, exec) { const scope = scopeOf(args.scope, exec); await approveGlobalMemoryMutation(ctx, exec, scope, 'proposal'); return present(await ctx.memory.propose({ scope, statement: args.statement, evidence: args.evidence.map(ref => ({ kind: 'agent' as const, ref })), trust: { score: args.trust, source: 'agent' }, ...args.valid_until === undefined ? {} : { validity: { validUntil: args.valid_until } }, ...args.contradicts === undefined ? {} : { contradicts: args.contradicts.map(MemoryId) } })) },
    presentCall: args => ({ card: 'generic', title: 'Propose memory', kind: 'other', rawInput: args.statement }),
  }))
  ctx.tools.register(defineTool({
    name: 'memory_challenge', description: 'Challenge one exact memory revision with contrary evidence.',
    parameters: { id: { type: 'string', required: true }, revision: { type: 'number', required: true }, scope: { type: 'string', required: true, enum: ['project', 'global'] }, reason: { type: 'string', required: true }, evidence: { type: 'array', items: { type: 'string' } } }, output,
    async execute(args, exec) { const scope = scopeOf(args.scope, exec); await approveGlobalMemoryMutation(ctx, exec, scope, 'challenge'); return present(await ctx.memory.challenge({ ref: { scope, id: MemoryId(args.id), revision: args.revision }, reason: args.reason, evidence: (args.evidence ?? []).map(ref => ({ kind: 'agent' as const, ref })) })) },
    presentCall: args => ({ card: 'generic', title: 'Challenge memory', kind: 'other', rawInput: args.reason }),
  }))
  ctx.tools.register(defineTool({
    name: 'memory_checkpoint', description: 'Record that exact memory revisions were used in the current task.',
    parameters: { scope: { type: 'string', required: true, enum: ['project', 'global'] }, memories: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, revision: { type: 'number', required: true } } } } }, output,
    async execute(args, exec) { const scope = scopeOf(args.scope, exec); await approveGlobalMemoryMutation(ctx, exec, scope, 'checkpoint'); return json(await ctx.memory.checkpoint({ refs: args.memories.map(memory => ({ scope, id: MemoryId(memory.id), revision: memory.revision })) })) },
    presentCall: () => ({ card: 'generic', title: 'Checkpoint memory', kind: 'other' }),
  }))
}
