/** Portable transcript fixture: scripted storage outcomes, real prompt assembly and lifecycle dispatch. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { installWorkspaceGuidance } from '../../src/workspace-guidance.ts'
import type { ConversationWorkspaceId, WorkspaceState } from '../../src/workspace-types.ts'
import type { EnvironmentId } from '../../src/environment-types.ts'

export const name = 'snapshot-workspace-outcomes'
export const inject = ['agents', 'systemPrompt']
export const Config = z.object({ environment: z.boolean().default(false) })

/** Register deterministic storage receipts around a real completed coding turn.
 * @param ctx - shipped SDK profile scope.
 * @param config - whether to include independent environment and repository receipts.
 */
export function apply(ctx: Context, config: { environment: boolean }): void {
  ctx.on('agent/prepare', ({ agent }) => { installWorkspaceGuidance(agent) })
  ctx.on('agent/turn-settled', ({ agent, turn }) => {
    const state: WorkspaceState = { workspaceId: brandString<ConversationWorkspaceId>('a'.repeat(32)), turn,
      phase: 'saving', baseline: 'b'.repeat(40), checkpoint: 1, checkpointHash: 'c'.repeat(64), branches: {},
      ...config.environment ? { environmentId: brandString<EnvironmentId>('shared-environment'), repositories: [
        { remote: 'https://github.example/org/first.git', path: '/workspace/repos/1111111111111111', baseline: 'b'.repeat(40), lastTurn: 0, branches: {} },
        { remote: 'https://github.example/org/second.git', path: '/workspace/repos/2222222222222222', baseline: 'e'.repeat(40), lastTurn: 0, branches: {} },
      ] } : {} }
    agent.session.append('workspace/state', state)
    agent.session.append('workspace/state', { ...state, phase: 'pending', error: 'Result branch changed outside this conversation.' })
    agent.session.append('workspace/state', { ...state, phase: 'returned', checkpoint: 2,
      ...state.repositories === undefined ? {} : {
        repositories: state.repositories.map(repository => ({ ...repository, lastTurn: turn })),
      },
      branches: { 'refs/heads/dsh/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/main/turn-1': 'd'.repeat(40) } })
  })
}
