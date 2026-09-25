/** Portable transcript fixture: scripted storage outcomes, real prompt assembly and lifecycle dispatch. */
import { SessionSeq } from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { installWorkspaceGuidance } from '../../src/workspace-guidance.ts'
import type { ConversationWorkspaceId, WorkspaceState, WorkspaceProvenanceId, WorkspaceAdmissionId } from '../../src/workspace-types.ts'

export const name = 'snapshot-workspace-outcomes'
export const inject = ['agents', 'systemPrompt']
export const Config = z.object({ provenance: z.boolean().default(false), admission: z.boolean().default(false) })

/** Register deterministic storage receipts around a real completed coding turn.
 * @param ctx - shipped SDK profile scope.
 * @param config - optional provenance fixture selection.
 */
export function apply(ctx: Context, config: { provenance: boolean; admission: boolean }): void {
  ctx.on('agent/prepare', ({ agent }) => { installWorkspaceGuidance(agent) })
  ctx.on('agent/turn-starting', async ({ agent }, next) => {
    if (config.admission) {
      const id = brandString<WorkspaceAdmissionId>('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
      agent.session.append('workspace/admission', { id, status: 'waiting' })
      agent.session.append('workspace/admission', { id, status: 'admitted' })
    }
    await next()
  })
  ctx.on('agent/turn-settled', ({ agent, turn }) => {
    const state: WorkspaceState = { workspaceId: brandString<ConversationWorkspaceId>('a'.repeat(32)), turn,
      phase: 'saving', baseline: 'b'.repeat(40), checkpoint: 1, checkpointHash: 'c'.repeat(64), branches: {} }
    agent.session.append('workspace/state', state)
    agent.session.append('workspace/state', { ...state, phase: 'pending', error: 'Result branch changed outside this conversation.' })
    const branches = config.provenance ? {
      'refs/heads/dsh/fix-recovery-111111111111111111111111/turn-1': 'd'.repeat(40),
      'refs/heads/dsh/fix-recovery-222222222222222222222222/turn-1': 'd'.repeat(40),
    } : { 'refs/heads/dsh/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/main/turn-1': 'd'.repeat(40) }
    if (config.provenance) {
      const end = agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')!
      agent.session.append('workspace/provenance', {
        version: 1, id: brandString<WorkspaceProvenanceId>('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
        workspaceId: state.workspaceId, sessionId: agent.session.id, turn,
        eventRange: [SessionSeq(0), end.seq], repository: '/example/repository',
        baseline: state.baseline, createdAt: '2026-09-23T12:00:00Z',
        refs: Object.entries(branches).map(([branch, commit], index) => ({ source: index === 0 ? 'HEAD' : 'refs/heads/main', branch, commit, topic: 'fix-recovery' })),
        observedCommits: ['d'.repeat(40), 'e'.repeat(40)], createdCommits: ['d'.repeat(40)],
      })
    }
    agent.session.append('workspace/state', { ...state, phase: 'returned', checkpoint: 2,
      branches })
  })
}
