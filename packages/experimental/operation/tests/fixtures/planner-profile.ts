/** Synthetic judgment fixture with the real scoped planner and foreground shell action. */
import type { Context } from '@deepseek-ai/cordis'
import * as operationAgent from '../../src/agent.ts'
import type { OperationJudgmentProvider } from '../../src/types.ts'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '../../src/index.ts'

export const name = 'operation-planner-sdk-fixture'
export const inject = ['operations', 'agents']

const identity = { provider: 'synthetic-planner-fixture', model: 'fixture-not-a-qualified-model',
  encoder: 'fixture', tokenizer: 'fixture', serialization: 'fixture-json', deployment: 'fixture-only',
  deploymentManifest: { reference: 'synthetic-only', digest: 'fixture-only' } } as const
const provider: OperationJudgmentProvider = {
  identity,
  async prepare(draft) { return { draft, wire: { id: draft.id }, identity, inputTokens: 1 } },
  async rank(prepared) {
    const complete = prepared.draft.candidates.find(candidate => candidate.kind === 'complete')
    if (complete === undefined) throw new Error('one-step fixture requires a completion checkpoint')
    return { requestId: prepared.draft.id, identity, usage: { inputTokens: 1, outputTokens: 0 },
      probabilities: Object.fromEntries(prepared.draft.candidates.map(candidate => [candidate.id, candidate === complete ? 1 : 0])) }
  },
}

/**
 * Register synthetic judgment and synchronously compose each SDK caller's planner.
 * @param ctx Shipped SDK profile context with the operation service and real bash tool.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.operations.registerJudgmentProvider(provider))
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.inject(operationAgent.inject, (runtimeCtx) => {
      operationAgent.apply(runtimeCtx, { tools: ['bash'], maxMutationBytes: 32, maxCatalogBytes: 65_536 })
    })
  })
}
