/** Fair turn admission for shared environments; child work shares its parent reservation. @module */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { WorkspaceAdmissionId } from './workspace-types.ts'
import { WorkspaceAdmission } from './workspace-admission.ts'

interface Group {
  users: number
  cancel: AbortController
  ready: Promise<() => void>
}
interface Request {
  cancel: AbortController
  release: () => void
}

/** Queues root conversations without consuming execution for idle Session identities. */
export class SharedVmAdmission {
  private readonly pool: WorkspaceAdmission
  private readonly owners = new Map<Agent, Agent>()
  private readonly groups = new Map<Agent, Group>()
  private readonly requests = new Map<Agent, Request>()
  private readonly pending = new Set<Promise<void>>()
  private closing = false

  /**
   * @param ctx - shared environment's Agent lifecycle registrations.
   * @param capacity - maximum admitted root conversations; children share their root's permit.
   */
  constructor(ctx: Context, capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('shared-vm: invalid conversation capacity')
    this.pool = new WorkspaceAdmission(capacity)
    ctx.on('agent/prepare', ({ agent, origin: { parentAgent } }) => {
      if (this.closing) throw new Error('shared-vm: runtime is closing')
      const owner = parentAgent === undefined ? agent : this.owners.get(parentAgent)
      if (owner === undefined) throw new Error('shared-vm: parent conversation has no execution admission owner')
      this.owners.set(agent, owner)
      agent.ctx.effect(() => () => {
        this.release(agent)
        this.owners.delete(agent)
      }, 'shared environment admission owner')
    })
    ctx.on('agent/session-start', ({ agent, source }) => {
      if (source !== 'resume') return
      const waiting = new Set<WorkspaceAdmissionId>()
      for (const event of agent.session.snapshotEvents()) {
        if (event.type !== 'workspace/admission') continue
        if (event.data.status === 'waiting') waiting.add(event.data.id)
        else waiting.delete(event.data.id)
      }
      for (const id of waiting) agent.session.append('workspace/admission', { id, status: 'cancelled' })
    })
    ctx.on('agent/turn-starting', (payload, next) => {
      const operation = this.admit(payload.agent, payload.signal, next)
      this.pending.add(operation)
      void operation.finally(() => this.pending.delete(operation)).catch(() => undefined)
      return operation
    })
    ctx.on('agent/turn-settled', ({ agent }) => { this.release(agent) })
    ctx.on('agent/status', ({ agent, status }) => { if (status === 'idle') this.release(agent) })
  }

  /** Cancel and join waiting admission; active Agent scopes retain their own settlement. */
  async close(): Promise<void> {
    this.closing = true
    for (const request of this.requests.values()) request.cancel.abort(new Error('shared-vm: runtime is closing'))
    await Promise.allSettled(this.pending)
  }

  private async admit(agent: Agent, signal: AbortSignal, next: () => unknown): Promise<void> {
    if (this.closing) throw new Error('shared-vm: runtime is closing')
    if (this.requests.has(agent)) throw new Error('shared-vm: conversation already holds turn admission')
    const owner = this.owners.get(agent)
    if (owner === undefined) throw new Error('shared-vm: conversation has no execution admission owner')
    const id = brandString<WorkspaceAdmissionId>(randomUUID())
    agent.session.append('workspace/admission', { id, status: 'waiting' })
    let group = this.groups.get(owner)
    if (group === undefined) {
      const cancel = new AbortController()
      group = { users: 0, cancel, ready: this.pool.acquire(cancel.signal) }
      this.groups.set(owner, group)
    }
    const captured = group
    captured.users++
    const request: Request = {
      cancel: new AbortController(),
      release: () => {
        captured.users--
        if (captured.users !== 0) return
        this.groups.delete(owner)
        captured.cancel.abort(new Error('shared-vm: admission has no remaining owner'))
        void captured.ready.then((release) => { release() }, () => undefined)
      },
    }
    this.requests.set(agent, request)
    const combined = AbortSignal.any([signal, request.cancel.signal])
    try {
      await waitForAdmission(captured.ready, combined)
      combined.throwIfAborted()
      agent.session.append('workspace/admission', { id, status: 'admitted' })
      await next()
    } catch (error) {
      agent.session.append('workspace/admission', combined.aborted
        ? { id, status: 'cancelled' }
        : { id, status: 'failed', error: error instanceof Error ? error.message : String(error) })
      this.release(agent)
      throw error
    }
  }

  private release(agent: Agent): void {
    const request = this.requests.get(agent)
    if (request === undefined) return
    this.requests.delete(agent)
    request.cancel.abort(new Error('shared-vm: conversation admission released'))
    request.release()
  }
}

function waitForAdmission(ready: Promise<() => void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    // Abort reasons are caller-owned values and must retain their original identity.
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Agent cancellation carries a structured caller-owned cause.
    const abort = (): void => { reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    void ready.then(() => { signal.removeEventListener('abort', abort); resolve() }, (error: unknown) => {
      signal.removeEventListener('abort', abort)
      reject(new Error('shared-vm: admission failed', { cause: error }))
    })
  })
}
