/**
 * Session Info service: one Remote-only read that assembles a Session's
 * identity, Workspace, execution environment, and effective
 * command-authorization policy for the Web client.
 *
 * Every fact is read from the service that owns it — the Session header, the
 * registered projection units, the sandbox policy, the approval service, and
 * the Workspace registry — and each absent owner degrades to an explicit null
 * instead of a fabricated value.
 *
 * @module @deepseek-ai/dsh-session-info/service
 */

import { homedir, release } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: declares `ctx.sessions` on the Cordis Context.
import type {} from '@deepseek-ai/dsh-session'
// Type-only: declares `ctx.sessionProjections` on the Cordis Context.
import type {} from '@deepseek-ai/dsh-session-projection'
// Type-only: supplies the `modelSelection` projection declaration.
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
// Type-only: supplies the `title` projection declaration.
import type {} from '@deepseek-ai/dsh-session-title/types'
// Type-only: supplies the `agentPreset` projection declaration.
import type {} from '@deepseek-ai/dsh-agent-presets/types'
// Type-only: supplies the `sessionStats` projection declaration.
import type {} from '@deepseek-ai/dsh-session-stats/types'
// Type-only: supplies the `permissions` projection declaration.
import type {} from '@deepseek-ai/dsh-permission-presets/types'
// Type-only: declares `ctx.sandboxPolicy` on the Cordis Context.
import type {} from '@deepseek-ai/dsh-sandbox-policy'
// Type-only: declares `ctx.approval` on the Cordis Context.
import type {} from '@deepseek-ai/dsh-user-approval'
// Type-only: declares `ctx.workspaceRegistry` on the Cordis Context.
import type {} from '@deepseek-ai/dsh-workspace'
import type {
  SessionInfoReadRequest,
  SessionInfoReadResult,
  SessionInfoSnapshot,
} from './types.ts'

/** Client-visible projection units this reading consumes, in one consistent cut. */
const PROJECTION_KEYS = ['title', 'agentPreset', 'modelSelection', 'sessionStats', 'permissions'] as const

/**
 * Remote-only service answering, for the Web client, what a Session is running
 * as, where it runs, and under which command-authorization policy.
 */
export class SessionInfoService extends TypertRemoteService {
  static inject = ['sessions', 'sessionProjections']

  /**
   * @param ctx - Host context carrying live Sessions and the projection registry.
   */
  constructor(ctx: Context) {
    super(ctx, 'sessionInfo')
  }

  /**
   * Assemble one point-in-time information snapshot for a Session.
   * @param request - the Session to describe.
   * @param signal - carrier cancellation; an already-cancelled call reads nothing.
   * @returns the snapshot, or `session-unavailable` when the Session is not live.
   */
  @Remote('read')
  read(request: SessionInfoReadRequest, signal: AbortSignal): Promise<SessionInfoReadResult> {
    if (signal.aborted) {
      return Promise.resolve({ ok: false, error: { reason: 'session-unavailable', detail: 'request aborted before the Session was read' } })
    }
    const session = this.ctx.sessions.get(request.sessionId)
    if (session === undefined) {
      return Promise.resolve({
        ok: false,
        error: { reason: 'session-unavailable', detail: `session "${request.sessionId}" is not live on this Host` },
      })
    }

    const values = this.ctx.sessionProjections.snapshot(session, PROJECTION_KEYS).values
    const selection = values.modelSelection
    const model = selection === undefined ? null : selection.lastUsed ?? selection.next
    const stats = values.sessionStats
    const permissions = values.permissions
    const option = permissions === undefined
      ? undefined
      : permissions.options.find(candidate => candidate.value === permissions.currentValue)

    const policy = this.ctx.get('sandboxPolicy')
    const resolved = policy?.resolve({ session })
    const approval = this.ctx.get('approval')
    const registry = this.ctx.get('workspaceRegistry')
    const workspace = registry?.list().find(candidate => candidate.sessionIds.includes(session.header.id)) ?? null

    const snapshot: SessionInfoSnapshot = {
      session: {
        sessionId: session.header.id,
        title: values.title ?? null,
        agentPreset: values.agentPreset ?? null,
        model: model === null ? null : { provider: model.provider, model: model.model },
        cwd: session.header.cwd ?? null,
        turns: stats?.turns ?? 0,
        steps: stats?.steps ?? 0,
      },
      workspace: workspace === null
        ? null
        : { workspaceId: workspace.id, path: workspace.path, title: workspace.title },
      environment: {
        placement: permissions?.context?.environment ?? 'unknown',
        platform: process.platform,
        arch: process.arch,
        release: release(),
        node: process.version,
        home: homedir(),
      },
      policies: {
        sandboxMode: resolved?.mode ?? null,
        sandboxDefault: policy?.defaultMode ?? null,
        workspaceRoot: resolved?.workspaceRoot ?? null,
        approvalPolicy: approval === undefined
          ? null
          : approval.overrideOf(session) ?? approval.config.policy ?? 'ask',
        approvalDefault: approval === undefined ? null : approval.config.policy ?? 'ask',
        permissionPreset: permissions?.currentValue ?? null,
        permissionPresetDescription: option?.description ?? null,
        canChangePermission: permissions?.canChange ?? null,
      },
      readAt: Date.now(),
    }
    return Promise.resolve({ ok: true, value: snapshot })
  }
}

export default SessionInfoService
