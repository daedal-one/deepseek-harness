/** Portable transcript fixture: scripted storage outcomes, real prompt assembly and lifecycle dispatch. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { installWorkspaceGuidance } from '../../src/workspace-guidance.ts'
import type { ConversationWorkspaceId, WorkspaceState } from '../../src/workspace-types.ts'

export const name = 'snapshot-workspace-outcomes'
export const inject = ['agents', 'systemPrompt']
export interface Config { pendingError: string }
export const Config: z<Config> = z.object({ pendingError: z.string().default('Result branch changed outside this conversation.') })

/** Register deterministic storage receipts around a real completed coding turn.
 * @param ctx - shipped SDK profile scope.
 * @param config - scenario-owned save diagnostic.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('agent/prepare', ({ agent }) => { installWorkspaceGuidance(agent) })
  ctx.on('agent/turn-settled', ({ agent, turn }) => {
    const state: WorkspaceState = { workspaceId: brandString<ConversationWorkspaceId>('a'.repeat(32)), turn,
      phase: 'saving', baseline: 'b'.repeat(40), checkpoint: 1, checkpointHash: 'c'.repeat(64), branches: {} }
    agent.session.append('workspace/state', state)
    agent.session.append('workspace/state', { ...state, phase: 'pending', error: config.pendingError })
    agent.session.append('workspace/state', { ...state, phase: 'returned', checkpoint: 2,
      branches: { 'refs/heads/dsh/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/main/turn-1': 'd'.repeat(40) } })
  })
}
