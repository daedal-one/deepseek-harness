/** Synthetic judgment fixture with the real scoped planner and foreground shell action. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import * as operationAgent from '../../src/agent.ts'
import type { OperationJudgmentProvider } from '../../src/types.ts'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '../../src/index.ts'

export const name = 'operation-planner-sdk-fixture'
export const inject = ['operations', 'agents']

/** Synthetic checkpoint failure for recorded planner feedback. */
export interface Config { failPreparation?: boolean }
/** Fixture-owned failure selection. */
export const Config: z<Config> = z.object({ failPreparation: z.boolean().default(false) })

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
 * @param config Optional deterministic checkpoint failure.
 */
export function apply(ctx: Context, config: Config): void {
  const selectedProvider = config.failPreparation ? {
    ...provider, async prepare() { throw new Error('fixture decision service unavailable') },
  } : provider
  ctx.effect(() => ctx.operations.registerJudgmentProvider(selectedProvider))
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.inject(operationAgent.inject, (runtimeCtx) => {
      operationAgent.apply(runtimeCtx, { tools: ['bash'], maxMutationBytes: 32, maxCatalogBytes: 65_536 })
    })
  })
}
