/** Shared Client Session installation with caller-owned platform inputs. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { createSessionControlStream } from './transport.ts'
import { ClientSessions } from './sessions/service.ts'
import type { SessionRemotes } from './sessions/remotes.ts'
import type { SessionClientOptions } from './platform.ts'
import type {} from '../remote-events.ts'

/** Required Remote and Context projection services. */
export const inject = [
  'connection',
  'typert',
  'remote',
  'remote.commands',
  'remote.session',
  'remote.subagents',
]

/**
 * Install Client Session state and its reconnecting control stream.
 * @param ctx - Client Cordis context for one host.
 * @param options - platform callbacks and hydrated host-specific navigation.
 */
export function applySessions(ctx: Context, options: SessionClientOptions): void {
  const remotes = ctx.remote as unknown as SessionRemotes
  const sessions = new ClientSessions(ctx, remotes, options)
  ctx.remote.$on('api-session/added', (summary) => { sessions.handleSessionAdded(summary) })
  ctx.remote.$on('api-session/removed', (sessionId) => { sessions.handleSessionRemoved(sessionId) })
  ctx.remote.$on('api-session/status', (sessionId, running) => {
    sessions.handleSessionStatus(sessionId, running)
  })
  ctx.remote.$on('api-session/activity', (sessionId, updatedAt) => {
    sessions.handleSessionActivity(sessionId, updatedAt)
  })
  ctx.remote.$on('api-session/error', (sessionId, message) => {
    sessions.handleSessionError(sessionId, message)
  })

  const control = createSessionControlStream(remotes, {
    accept: (frame) => { sessions.handleControlFrame(frame) },
    failed: (error) => { console.error('[session-controller] control stream failed:', error) },
  })
  control.start()
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.effect(() => connection.generation.subscribe(() => {
    if (connection.generation.getSnapshot() === undefined) sessions.handleDisconnected()
  }), 'session-controller.client.connection-loss')
  ctx.on('connection/reset', () => { sessions.handleConnected() })
  if (ctx.remote.$host.home !== undefined) sessions.handleConnected()
  ctx.typert.contexts.registerClient('agent', {
    identity: candidate => sessions.scopeOf(candidate),
    resolve: sessionId => sessions.resolveAgentScope(sessionId),
  })
  ctx.effect(() => async () => { await control.dispose() }, 'session-controller.client.control')
}
