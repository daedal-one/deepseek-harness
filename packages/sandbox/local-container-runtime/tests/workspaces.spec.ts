import { execFile } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionStore, { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import ProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Commands from '@deepseek-ai/dsh-commands'
import type { LocalContainerRuntime } from '../src/index.ts'
import Workspaces, { type ConversationWorkspaceConfig } from '../src/workspaces.ts'
import type { PodmanControllerExecRequest, PodmanControllerExecResult } from '../src/types.ts'
import { workspaceGit } from '../src/workspace-git.ts'
import * as broker from '../src/workspace-git.ts'
import * as provenance from '../src/workspace-provenance.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

// These tests exercise persistence and transaction ordering with a local controller.
// Only workspaces.e2e.ts establishes container isolation and physical tmpfs limits.
class LocalStorageWorkspaces extends Workspaces {
  override [Service.init](): Promise<void> { return Promise.resolve() }
}

const disposers: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  const results = await Promise.allSettled(disposers.splice(0).reverse().map(dispose => dispose()))
  const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
  if (failures.length > 0) throw new AggregateError(failures, 'workspace fixture cleanup failed')
})

async function fixture(options: {
  pinWorkspace?: boolean
  message?: boolean
  failAfterCommit?: boolean
  retryDelayMs?: number
  script?: ConstructorParameters<typeof MockAdapter>[0]
} = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-workspaces-')))
  const source = join(root, 'source'); const pool = join(root, 'slot'); const secondPool = join(root, 'second-slot'); const recovery = join(root, 'recovery')
  await Promise.all([source, pool, secondPool, recovery].map(path => mkdir(path, { mode: 0o700 })))
  const config: ConversationWorkspaceConfig = {
    poolPaths: [pool, secondPool], slotBytes: 67108864, slotInodes: 20000, recoveryRoot: recovery, provenanceRoot: join(recovery, 'provenance'),
    gitCommand: '/usr/bin/git', authorName: 'DSH', authorEmail: 'dsh@localhost', resourceLimitCommand: '/usr/bin/prlimit', gitMemoryBytes: 536870912,
    maxBytes: 4194304, maxEntries: 1000, timeoutMs: 30000, maxOutputBytes: 8388608,
    settleTimeoutMs: 1000, retryDelayMs: options.retryDelayMs ?? 10000,
    messageInputBytes: 4096, messageOutputTokens: 64, messageTimeoutMs: 1000,
    ...options.message === true ? { messageProvider: 'mock', messageModel: 'cheap' } : {},
  }
  await workspaceGit(source, ['init', '--template=', '--initial-branch=main'], config)
  await writeFile(join(source, 'input.txt'), 'initial\n')
  await workspaceGit(source, ['add', '.'], config); await workspaceGit(source, ['commit', '-m', 'initial'], config)
  let ctx = new Context()
  const pins = new Map<Agent, { done: () => void; operation: Promise<void>; execution: string }>()
  const unpinAll = async () => {
    for (const pin of pins.values()) pin.done()
    await Promise.all([...pins.values()].map(pin => pin.operation))
    pins.clear()
  }
  const worlds = new Map<object, string>()
  let failAfterCommit = options.failAfterCommit === true
  const execute = async (directory: string, request: PodmanControllerExecRequest): Promise<PodmanControllerExecResult> => {
    return await new Promise((resolve, reject) => {
      const script = String(request.argv[2]).replace("ROOT='/workspace'", `ROOT=${JSON.stringify(directory)}`)
      const child = execFile('/usr/bin/python3', ['-c', script], {
        maxBuffer: request.maxOutputBytes, timeout: config.timeoutMs, encoding: 'buffer',
      }, (error, stdout, stderr) => {
        if (error !== null) reject(new Error('local test controller failed', { cause: error }))
        else {
          const input = JSON.parse(Buffer.from(request.stdin ?? []).toString()) as { operation: string }
          if (input.operation === 'commit' && failAfterCommit) {
            failAfterCommit = false
            reject(new Error('injected lost commit acknowledgement'))
          } else resolve({ exitCode: 0, stdout, stderr })
        }
      })
      child.stdin?.end(request.stdin)
    })
  }
  const runtime = {
    async recoverWorkspace() {},
    async createWorkspace(directory: string) {
      const world = {
        executionWorld: {},
        executeController: (request: PodmanControllerExecRequest) => execute(directory, request),
        async cancelProcesses() {},
        async settle<T>(_timeout: number, operation: (
          control: (request: PodmanControllerExecRequest) => Promise<PodmanControllerExecResult>,
        ) => Promise<T>) {
          return await operation(world.executeController)
        },
      }
      worlds.set(world, directory)
      return { runtime: world, async dispose() {} }
    },
  }
  const boot = async () => {
    ctx.provide('localContainerRuntime', runtime as unknown as LocalContainerRuntime)
    await ctx.plugin(SessionStore); await ctx.plugin(ProjectionRegistry)
    await ctx.plugin(Persistence, { root: join(root, 'sessions'), compression: 'none' })
    await ctx.plugin(LlmRuntime); await ctx.plugin(AgentRegistry); await ctx.plugin(SystemPrompt); await ctx.plugin(Tools)
    await ctx.plugin(LocalStorageWorkspaces, config); await ctx.plugin(AgentLoop, { agents: [] })
  }
  await boot()
  disposers.push(async () => { await unpinAll(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const adapter = new MockAdapter(options.script ?? [textResponse('Done.'), textResponse('feat: retain changes'), textResponse(JSON.stringify({ HEAD: 'finish-task', 'refs/heads/codex/conversation': 'finish-task' })), textResponse('No further changes.')])
  ctx.llm.registerAdapter(['mock'], adapter)
  const handle = await ctx.agents.create({ sessionId: SessionId(`test-${root.split('/').at(-1)}`), meta: { cwd: source }, agentOptions: { provider: 'mock', model: 'main' } })
  const pin = async (agent: Agent): Promise<string> => {
    const existing = pins.get(agent)
    if (existing !== undefined) return existing.execution
    const ready = Promise.withResolvers<string>()
    const done = Promise.withResolvers<undefined>()
    const operation = ctx.conversationWorkspaces.runForSession(agent.id, async () => {
      const execution = worlds.get(ctx.conversationWorkspaces.capture())
      if (execution === undefined) throw new Error('missing fixture workspace')
      ready.resolve(execution)
      await done.promise
    })
    void operation.catch(ready.reject)
    const execution = await ready.promise
    pins.set(agent, { done: () => { done.resolve(undefined) }, operation, execution })
    agent.ctx.effect(() => async () => {
      done.resolve(undefined)
      try { await operation } finally { pins.delete(agent) }
    }, 'test workspace file access')
    return execution
  }
  const execution = options.pinWorkspace === false ? '' : await pin(handle.agent)
  const turn = async () => {
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Finish the task.' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    return handle.agent.session.snapshotEvents().findLast(event => event.type === 'workspace/state')
  }
  const executionFor = (agent: Agent) => pin(agent)
  const restart = async () => {
    await unpinAll()
    await ctx.fiber.dispose()
    ctx = new Context()
    await boot()
    ctx.llm.registerAdapter(['mock'], adapter)
    return ctx
  }
  return { ctx, root, source, pool, recovery, execution, config, handle, turn, adapter, executionFor, restart, unpinAll, worlds }
}

describe.skipIf(process.platform === 'win32')('conversation workspace transaction lifecycle', () => {
  it('retains capacity after a failed idle checkpoint and admits the waiter only after recovery', async () => {
    const f = await fixture({ retryDelayMs: 2_147_483_647 })
    const other = await f.ctx.agents.create({ sessionId: SessionId('checkpoint-other'), meta: { cwd: f.source }, agentOptions: { provider: 'mock', model: 'main' } })
    await f.executionFor(other.agent)
    const waiting = await f.ctx.agents.create({ sessionId: SessionId('checkpoint-waiter'), meta: { cwd: f.source }, agentOptions: { provider: 'mock', model: 'main' } })
    const runtime = f.ctx.agents.withInitiator(f.handle.agent, () => f.ctx.conversationWorkspaces.capture())
    const cancel = vi.spyOn(runtime, 'cancelProcesses')
    const save = vi.spyOn(runtime, 'settle').mockRejectedValue(new Error('writer still active'))
    await writeFile(join(f.execution, 'private.txt'), 'must survive')
    await f.handle.dispose()
    expect(cancel).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(join(f.pool, 'owner.json'), 'utf8'))).toMatchObject({ clean: false })
    let admitted = false
    const cancelled = new AbortController()
    const next = f.ctx.conversationWorkspaces.runForSession(waiting.agent.id, async () => { admitted = true }, cancelled.signal)
    try {
      await Promise.resolve()
      expect(admitted).toBe(false)
      save.mockRestore()
      const resumed = await f.ctx.agents.resume({ resumeSessionId: f.handle.agent.id, agentOptions: { provider: 'mock', model: 'main' } })
      await f.ctx.conversationWorkspaces.runForSession(resumed.agent.id, async () => {
        const path = f.worlds.get(f.ctx.conversationWorkspaces.capture())!
        expect(await readFile(join(path, 'private.txt'), 'utf8')).toBe('must survive')
      })
      await next
      expect(admitted).toBe(true)
      await resumed.dispose()
    } finally {
      cancelled.abort()
      await Promise.allSettled([next, other.dispose(), waiting.dispose()])
    }
  })

  it('checkpoints an unclean vacant slot before another conversation reuses it', async () => {
    const f = await fixture()
    await writeFile(join(f.execution, 'retained.txt'), 'unclean data')
    await f.unpinAll()
    const receipt = JSON.parse(await readFile(join(f.pool, 'owner.json'), 'utf8')) as object
    await writeFile(join(f.pool, 'owner.json'), JSON.stringify({ ...receipt, clean: false }))
    await writeFile(join(f.execution, 'retained.txt'), 'latest unclean data')
    const other = await f.ctx.agents.create({ sessionId: SessionId('recover-vacant'), meta: { cwd: f.source }, agentOptions: { provider: 'mock', model: 'main' } })
    await f.ctx.conversationWorkspaces.runForSession(other.agent.id, async () => {
      const path = f.worlds.get(f.ctx.conversationWorkspaces.capture())!
      await expect(readFile(join(path, 'retained.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    })
    await f.ctx.conversationWorkspaces.runForSession(f.handle.agent.id, async () => {
      const path = f.worlds.get(f.ctx.conversationWorkspaces.capture())!
      expect(await readFile(join(path, 'retained.txt'), 'utf8')).toBe('latest unclean data')
    })
    await other.dispose()
  })

  it('queues model execution and cancels a waiting turn without starting it', async () => {
    const f = await fixture({ pinWorkspace: false, script: ['hang', 'hang', textResponse('Done.')] })
    const handles = [f.handle]
    for (let index = 1; index < 4; index++) handles.push(await f.ctx.agents.create({
      sessionId: SessionId(`turn-queue-${index}`), meta: { cwd: f.source },
      agentOptions: { provider: 'mock', model: 'main' },
    }))
    const send = (index: number) => {
      handles[index]!.agent.followup(createUserMessage({
        content: [{ type: 'text', text: `Message ${index}` }], source: { kind: 'user' },
      }))
    }
    const admission = (index: number) => handles[index]!.agent.session.snapshotEvents()
      .filter(event => event.type === 'workspace/admission').map(event => event.data.status)
    try {
      send(0); send(1)
      await expect.poll(() => f.adapter.requests.length).toBe(2)
      send(2); send(3)
      await expect.poll(() => admission(3)).toEqual(['waiting'])
      expect(admission(2)).toEqual(['waiting'])
      expect(f.adapter.requests).toHaveLength(2)
      handles[3]!.agent.cancel({ kind: 'user' })
      await handles[3]!.agent.whenIdle()
      expect(admission(3)).toEqual(['waiting', 'cancelled'])
      expect(handles[3]!.agent.session.snapshotEvents().some(event => event.type === 'turn/start')).toBe(false)
      expect(f.adapter.requests).toHaveLength(2)
      handles[0]!.agent.cancel({ kind: 'user' })
      await handles[0]!.agent.whenIdle()
      await handles[2]!.agent.whenIdle()
      expect(admission(2)).toEqual(['waiting', 'admitted'])
      expect(f.adapter.requests).toHaveLength(3)
    } finally {
      for (const handle of handles) handle.agent.cancel({ kind: 'user' })
      await Promise.all(handles.map(async (handle) => { await handle.agent.whenIdle(); await handle.dispose() }))
    }
  })

  it('creates more conversations than slots and queues isolated cancellable file work', async () => {
    const f = await fixture({ pinWorkspace: false })
    const handles = [f.handle]
    for (let index = 1; index < 5; index++) handles.push(await f.ctx.agents.create({
      sessionId: SessionId(`queued-${index}`), meta: { cwd: f.source },
      agentOptions: { provider: 'mock', model: 'main' },
    }))
    expect(f.worlds.size).toBe(0)
    const firstReady = Promise.withResolvers<undefined>()
    const firstDone = Promise.withResolvers<undefined>()
    const secondReady = Promise.withResolvers<undefined>()
    const secondDone = Promise.withResolvers<undefined>()
    const path = () => {
      const value = f.worlds.get(f.ctx.conversationWorkspaces.capture())
      if (value === undefined) throw new Error('workspace operation has no runtime')
      return value
    }
    const first = f.ctx.conversationWorkspaces.runForSession(handles[0]!.agent.id, async () => {
      await writeFile(join(path(), 'private.txt'), 'first conversation')
      firstReady.resolve(undefined)
      await firstDone.promise
    })
    const second = f.ctx.conversationWorkspaces.runForSession(handles[1]!.agent.id, async () => {
      await expect(readFile(join(path(), 'private.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
      secondReady.resolve(undefined)
      await secondDone.promise
    })
    await Promise.all([firstReady.promise, secondReady.promise])
    const cancelled = new AbortController()
    let cancelledRan = false
    const third = f.ctx.conversationWorkspaces.runForSession(handles[2]!.agent.id,
      async () => { cancelledRan = true }, cancelled.signal)
    const rejection = expect(third).rejects.toThrow('cancel queued work')
    const fourthReady = Promise.withResolvers<undefined>()
    const fourthDone = Promise.withResolvers<undefined>()
    let fourthRan = false
    const fourth = f.ctx.conversationWorkspaces.runForSession(handles[3]!.agent.id, async () => {
      fourthRan = true
      await expect(readFile(join(path(), 'private.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
      fourthReady.resolve(undefined)
      await fourthDone.promise
    })
    try {
      await Promise.resolve()
      expect(fourthRan).toBe(false)
      cancelled.abort(new Error('cancel queued work'))
      await rejection
      expect(cancelledRan).toBe(false)
      expect(fourthRan).toBe(false)
      firstDone.resolve(undefined)
      await first
      await fourthReady.promise
      expect(fourthRan).toBe(true)
      fourthDone.resolve(undefined)
      await fourth
      await f.ctx.conversationWorkspaces.runForSession(handles[0]!.agent.id, async () => {
        expect(await readFile(join(path(), 'private.txt'), 'utf8')).toBe('first conversation')
      })
    } finally {
      firstDone.resolve(undefined); secondDone.resolve(undefined); fourthDone.resolve(undefined)
      await Promise.allSettled([first, second, third, fourth])
      await Promise.all(handles.map(handle => handle.dispose()))
    }
  })

  it('names branches once and finds granular commits after host ref deletion and restart', async () => {
    const names = JSON.stringify({ HEAD: 'repair-session-recovery', 'refs/heads/codex/conversation': 'repair-session-recovery' })
    const f = await fixture({ message: true, script: [textResponse('Done.'), textResponse(names), textResponse('Done again.')] })
    await writeFile(join(f.execution, 'granular.txt'), 'granular change\n')
    await workspaceGit(f.execution, ['add', '.'], f.config)
    await workspaceGit(f.execution, ['commit', '-m', 'fix: granular change'], f.config)
    const granular = (await workspaceGit(f.execution, ['rev-parse', 'HEAD'], f.config)).toString().trim()
    expect((await f.turn())?.data).toMatchObject({ phase: 'returned' })
    const first = await f.ctx.conversationWorkspaces.lookupChanges(granular, new AbortController().signal)
    expect(first.records).toHaveLength(1)
    expect(first.records[0]).toMatchObject({ sessionId: f.handle.agent.id, observedCommits: [granular], createdCommits: [] })
    expect(first.records[0]!.refs.every(ref => ref.branch.includes('/repair-session-recovery-'))).toBe(true)
    await f.turn()
    expect(f.adapter.requests.filter(request => request.purpose === 'workspace-branch-name')).toHaveLength(1)
    const all = await f.ctx.conversationWorkspaces.lookupChanges(granular, new AbortController().signal)
    for (const record of all.records) for (const ref of record.refs) await workspaceGit(f.source, ['update-ref', '-d', ref.branch], f.config)
    const ctx = await f.restart()
    expect((await ctx.conversationWorkspaces.lookupChanges(granular.slice(0, 12), new AbortController().signal)).records).toHaveLength(2)
    expect((await workspaceGit(f.execution, ['rev-parse', 'HEAD'], f.config)).toString().trim()).toBe(granular)
  })

  it('links automatic commits to stable receipts and exports them through the disposable human command', async () => {
    const f = await fixture()
    const commands = await f.ctx.plugin(Commands)
    await writeFile(join(f.execution, 'result.txt'), 'result\n')
    expect((await f.turn())?.data).toMatchObject({ phase: 'returned' })
    const records = await f.ctx.conversationWorkspaces.lookupChanges(f.handle.agent.id, new AbortController().signal)
    const receipt = records.records[0]!
    expect(receipt.createdCommits).toHaveLength(1)
    const message = (await workspaceGit(f.source, ['show', '-s', '--format=%B', receipt.createdCommits[0]!], f.config)).toString()
    expect(message).toContain(`DSH-Session: ${f.handle.agent.id}`)
    expect(message).toContain(`DSH-Provenance: ${receipt.id}`)
    expect(f.handle.agent.session.snapshotEvents().filter(event => event.type === 'workspace/provenance')).toHaveLength(1)
    expect(f.ctx.commands.find(f.handle.agent, 'changes')).toBeDefined()
    const result = await f.ctx.commands.execute(f.handle.agent, '/changes export all', [], new AbortController().signal)
    expect(JSON.parse(result!.result.text!)).toEqual(records)
    await commands.dispose()
    expect(f.ctx.get('commands')).toBeUndefined()
  })

  it('reconciles published refs after a receipt-write failure without another naming call', async () => {
    const f = await fixture({ message: true, retryDelayMs: 2_147_483_647 })
    await writeFile(join(f.execution, 'result.txt'), 'result\n')
    const save = vi.spyOn(provenance, 'saveWorkspaceProvenance').mockRejectedValueOnce(new Error('receipt disk unavailable'))
    expect((await f.turn())?.data).toMatchObject({ phase: 'pending' })
    const head = await workspaceGit(f.execution, ['rev-parse', 'HEAD'], f.config)
    const refs = await workspaceGit(f.source, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/dsh/'], f.config)
    save.mockRestore()
    const ctx = await f.restart()
    const resumed = await ctx.agents.resume({ resumeSessionId: f.handle.agent.id, agentOptions: { provider: 'mock', model: 'main' } })
    await f.executionFor(resumed.agent)
    try {
      await expect.poll(() => resumed.agent.session.snapshotEvents().findLast(event => event.type === 'workspace/state')?.data, { timeout: 5000 }).toMatchObject({ phase: 'returned' })
      expect(await workspaceGit(f.execution, ['rev-parse', 'HEAD'], f.config)).toEqual(head)
      expect(await workspaceGit(f.source, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/dsh/'], f.config)).toEqual(refs)
      expect(f.adapter.requests.filter(request => request.purpose === 'workspace-branch-name')).toHaveLength(1)
      expect((await ctx.conversationWorkspaces.lookupChanges(f.handle.agent.id, new AbortController().signal)).records).toHaveLength(1)
      expect(resumed.agent.session.snapshotEvents().filter(event => event.type === 'workspace/provenance')).toHaveLength(1)
    } finally { await resumed.dispose() }
  })

  it('keeps a safe persisted fallback when the naming model emits an invalid ref', async () => {
    const f = await fixture({ message: true, script: [textResponse('Done.'), textResponse('{"HEAD":"../../escape"}'), textResponse('Done again.')] })
    expect((await f.turn())?.data).toMatchObject({ phase: 'returned' })
    const records = await f.ctx.conversationWorkspaces.lookupChanges('', new AbortController().signal)
    expect(records.records[0]!.refs.every(ref => ref.topic === 'finish-the-task')).toBe(true)
    await f.turn()
    expect(f.adapter.requests.filter(request => request.purpose === 'workspace-branch-name')).toHaveLength(1)
  })

  it('uses the fixed residual commit when no message route exists and preserves source state', async () => {
    const f = await fixture()
    const sourceHead = await workspaceGit(f.source, ['rev-parse', 'HEAD'], f.config)
    await writeFile(join(f.execution, 'result.txt'), 'result\n')
    expect((await f.turn())?.data).toMatchObject({ phase: 'returned', turn: 1 })
    expect((await workspaceGit(f.execution, ['log', '-1', '--format=%s'], f.config)).toString().trim())
      .toBe('chore: save remaining changes for turn 1')
    expect(await workspaceGit(f.source, ['rev-parse', 'HEAD'], f.config)).toEqual(sourceHead)
    await expect(readFile(join(f.source, 'result.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(f.handle.agent.session.snapshotEvents().some(event => event.type === 'workspace/commit-message-request')).toBe(false)
  })

  it('calls the optional subject model once, then makes no commit or auxiliary request for a clean turn', async () => {
    const f = await fixture({ message: true })
    await writeFile(join(f.execution, 'result.txt'), 'result\n')
    expect((await f.turn())?.data).toMatchObject({ phase: 'returned' })
    const committed = await workspaceGit(f.execution, ['rev-parse', 'HEAD'], f.config)
    expect((await workspaceGit(f.execution, ['log', '-1', '--format=%s'], f.config)).toString().trim()).toBe('feat: retain changes')
    expect((await f.turn())?.data).toMatchObject({ phase: 'returned', turn: 2 })
    expect(await workspaceGit(f.execution, ['rev-parse', 'HEAD'], f.config)).toEqual(committed)
    expect(f.handle.agent.session.snapshotEvents().filter(event => event.type === 'workspace/commit-message-request')).toHaveLength(1)
  })

  it('retries a lost commit acknowledgement without repeating the subject model or creating another commit', async () => {
    const f = await fixture({ message: true, failAfterCommit: true, retryDelayMs: 25 })
    await writeFile(join(f.execution, 'result.txt'), 'result\n')
    expect((await f.turn())?.data).toMatchObject({ phase: 'pending' })
    const committed = await workspaceGit(f.execution, ['rev-parse', 'HEAD'], f.config)
    await expect.poll(() => f.handle.agent.session.snapshotEvents().findLast(event => event.type === 'workspace/state')?.data,
      { timeout: 5000 }).toMatchObject({ phase: 'returned' })
    expect(await workspaceGit(f.execution, ['rev-parse', 'HEAD'], f.config)).toEqual(committed)
    expect(f.adapter.requests.filter(request => request.purpose === 'workspace-commit')).toHaveLength(1)
  })


  it.each(['candidate', 'message', 'committed', 'returned'].flatMap(phase => ['before', 'after'].map(edge => ({ phase, edge }))))(
    'recovers a restart $edge $phase publication without duplicate commits or subject calls', async ({ phase, edge }) => {
      const f = await fixture({ message: true, retryDelayMs: 2_147_483_647 })
      const publish = broker.publishWorkspaceJson
      let interrupted = false
      const failure = vi.spyOn(broker, 'publishWorkspaceJson').mockImplementation(async (path, value, maxBytes) => {
        const record = value as { lastTurn: number; transaction?: { message?: string; oid?: string } }
        const transaction = record.transaction
        const matches = path.endsWith('/state.json') && !interrupted && (phase === 'candidate'
          ? transaction !== undefined && transaction.message === undefined
          : phase === 'message' ? transaction?.message !== undefined && transaction.oid === undefined
            : phase === 'committed' ? transaction?.oid !== undefined
              : record.lastTurn === 1 && transaction === undefined)
        if (matches && edge === 'before') { interrupted = true; throw new Error('injected crash before publication') }
        await publish(path, value, maxBytes)
        if (matches) { interrupted = true; throw new Error('injected crash after publication') }
      })
      await writeFile(join(f.execution, 'result.txt'), 'result\n')
      const pending = await f.turn()
      expect(pending?.data).toMatchObject({ phase: 'pending' })
      expect(interrupted).toBe(true)
      if (pending?.type !== 'workspace/state') throw new Error('missing workspace receipt')
      const directory = join(f.recovery, pending.data.workspaceId)
      const crashImage = join(f.root, 'crash-image')
      await cp(directory, crashImage, { recursive: true })
      const committed = await workspaceGit(f.execution, ['rev-parse', 'HEAD'], f.config)
      failure.mockRestore()
      const ctx = await f.restart()
      // Reconstruct the exact durable bytes at the interruption, excluding orderly-shutdown publications.
      await rm(directory, { recursive: true }); await cp(crashImage, directory, { recursive: true })
      const resumed = await ctx.agents.resume({ resumeSessionId: f.handle.agent.id,
        agentOptions: { provider: 'mock', model: 'main' } })
      await f.executionFor(resumed.agent)
      try {
        await expect.poll(() => resumed.agent.session.snapshotEvents().findLast(event => event.type === 'workspace/state')?.data,
          { timeout: 5000 }).toMatchObject({ phase: 'returned' })
        expect((await workspaceGit(f.execution, ['rev-list', '--count', 'HEAD'], f.config)).toString().trim()).toBe('2')
        if (phase === 'committed' || phase === 'returned') {
          expect(await workspaceGit(f.execution, ['rev-parse', 'HEAD'], f.config)).toEqual(committed)
        }
        expect(f.adapter.requests.filter(request => request.purpose === 'workspace-commit'))
          .toHaveLength(phase === 'candidate' && edge === 'after' ? 0 : 1)
        const receipt = resumed.agent.session.snapshotEvents().findLast(event => event.type === 'workspace/state')
        if (receipt?.type !== 'workspace/state') throw new Error('missing resumed receipt')
        for (const [ref, oid] of Object.entries(receipt.data.branches)) {
          expect((await workspaceGit(f.source, ['rev-parse', ref], f.config)).toString().trim()).toBe(oid)
        }
      } finally { await resumed.dispose() }
    },
  )

  it('retains the last checkpoint and dirty RAM when a recovery payload exceeds the configured bound', async () => {
    const f = await fixture({ retryDelayMs: 25 })
    const ready = f.handle.agent.session.snapshotEvents().findLast(event => event.type === 'workspace/state')
    if (ready?.type !== 'workspace/state') throw new Error('missing prepared workspace')
    const statePath = join(f.recovery, ready.data.workspaceId, 'state.json')
    const before = JSON.parse(await readFile(statePath, 'utf8')) as { checkpoint: number }
    await writeFile(join(f.execution, 'oversized'), Buffer.alloc(f.config.maxBytes + 1))
    expect((await f.turn())?.data).toMatchObject({ phase: 'pending' })
    expect((JSON.parse(await readFile(statePath, 'utf8')) as { checkpoint: number }).checkpoint).toBe(before.checkpoint)
    expect((await readFile(join(f.execution, 'oversized'))).length).toBe(f.config.maxBytes + 1)
    await rm(join(f.execution, 'oversized'))
    await expect.poll(() => f.handle.agent.session.snapshotEvents().findLast(event => event.type === 'workspace/state')?.data,
      { timeout: 5000 }).toMatchObject({ phase: 'returned' })
  })

  it('retains dirty RAM and releases stopped-world leases when shutdown checkpointing fails', async () => {
    const f = await fixture()
    await writeFile(join(f.execution, 'unfinished.txt'), 'recover me')
    const publish = broker.publishWorkspaceJson
    const failure = vi.spyOn(broker, 'publishWorkspaceJson').mockImplementation(async (path, value, maxBytes) => {
      if (path.includes('/checkpoint-')) throw new Error('injected full recovery disk')
      await publish(path, value, maxBytes)
    })
    await f.handle.dispose()
    expect(failure).toHaveBeenCalled()
    failure.mockRestore()
    const resumed = await f.ctx.agents.resume({ resumeSessionId: f.handle.agent.id, agentOptions: { provider: 'mock', model: 'main' } })
    const execution = await f.executionFor(resumed.agent)
    if (execution === undefined) throw new Error('missing recovered workspace')
    expect(await readFile(join(execution, 'unfinished.txt'), 'utf8')).toBe('recover me')
    await resumed.dispose()
  })

  it('refuses a corrupt acknowledged checkpoint instead of reimporting the source', async () => {
    const f = await fixture()
    await f.turn(); await f.handle.dispose()
    const stateEvent = f.handle.agent.session.snapshotEvents().findLast(event => event.type === 'workspace/state')
    if (stateEvent?.type !== 'workspace/state') throw new Error('missing workspace state')
    const directory = join(f.recovery, stateEvent.data.workspaceId)
    const state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')) as { checkpoint: number }
    await writeFile(join(directory, `checkpoint-${state.checkpoint}.json`), JSON.stringify({ entries: [] }))
    const resumed = await f.ctx.agents.resume({ resumeSessionId: f.handle.agent.id,
      agentOptions: { provider: 'mock', model: 'main' } })
    await expect(f.executionFor(resumed.agent)).rejects.toThrow('integrity')
    await resumed.dispose()
  })

  it('checkpoints an unfinished merge before reporting blocked finalization', async () => {
    const f = await fixture({ message: true })
    const head = await workspaceGit(f.execution, ['rev-parse', 'HEAD'], f.config)
    await writeFile(join(f.execution, '.git/MERGE_HEAD'), head)
    await writeFile(join(f.execution, 'unfinished.txt'), 'merge work')
    const pending = await f.turn()
    expect(pending?.data).toMatchObject({ phase: 'pending', turn: 1 })
    if (pending?.type !== 'workspace/state') throw new Error('missing pending workspace receipt')
    const snapshot = JSON.parse(await readFile(join(f.recovery, pending.data.workspaceId,
      `checkpoint-${pending.data.checkpoint}.json`), 'utf8')) as { entries: Array<{ path: string; data: string }> }
    expect(snapshot.entries.find(entry => entry.path === 'unfinished.txt')?.data).toBe(Buffer.from('merge work').toString('base64'))
    expect(snapshot.entries.some(entry => entry.path === '.git/MERGE_HEAD')).toBe(true)
    expect(await workspaceGit(f.execution, ['rev-parse', 'HEAD'], f.config)).toEqual(head)
    expect(f.adapter.requests.filter(request => request.purpose === 'workspace-commit')).toHaveLength(0)
    expect((await workspaceGit(f.source, ['for-each-ref', 'refs/heads/dsh/'], f.config)).length).toBe(0)
  })

  it('checkpoints cancelled work without an automatic commit, branch return, or subject request', async () => {
    const f = await fixture({ message: true, script: ['hang'] })
    const started = Promise.withResolvers<undefined>()
    f.ctx.on('agent/assistant-stream', ({ frame }) => { if (frame.type === 'chunk') started.resolve(undefined) })
    await writeFile(join(f.execution, 'unfinished.txt'), 'partial work\n')
    const head = await workspaceGit(f.execution, ['rev-parse', 'HEAD'], f.config)
    const turn = f.turn()
    await started.promise
    f.handle.agent.cancel({ kind: 'user' })
    expect((await turn)?.data).toMatchObject({ phase: 'checkpointed' })
    expect(await workspaceGit(f.execution, ['rev-parse', 'HEAD'], f.config)).toEqual(head)
    expect((await workspaceGit(f.source, ['for-each-ref', 'refs/heads/dsh/'], f.config)).length).toBe(0)
    expect(f.adapter.requests.filter(request => request.purpose === 'workspace-commit')).toHaveLength(0)
    await f.handle.dispose()
    await rm(f.pool, { recursive: true }); await mkdir(f.pool, { mode: 0o700 })
    const resumed = await f.ctx.agents.resume({ resumeSessionId: f.handle.agent.id,
      agentOptions: { provider: 'mock', model: 'main' } })
    await f.executionFor(resumed.agent)
    expect(await readFile(join(f.pool, 'workspace', 'unfinished.txt'), 'utf8')).toBe('partial work\n')
    await resumed.dispose()
  })

  it('shares the parent repository with a child but returns branches only when the parent settles', async () => {
    const f = await fixture()
    const child = await f.ctx.agents.create({ sessionId: SessionId('child'), parentAgent: f.handle.agent,
      meta: { cwd: f.source }, agentOptions: { provider: 'mock', model: 'main' } })
    expect(await f.executionFor(child.agent)).toBe(f.execution)
    await writeFile(join(f.execution, 'child.txt'), 'child result\n')
    child.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Finish.' }], source: { kind: 'user' } }))
    await child.agent.whenIdle()
    expect((await workspaceGit(f.source, ['for-each-ref', 'refs/heads/dsh/'], f.config)).length).toBe(0)
    expect((await f.turn())?.data).toMatchObject({ phase: 'returned' })
    await child.dispose()
  })

  it('forks the recorded checkpoint into an independent repository instead of reimporting host files', async () => {
    const f = await fixture()
    await writeFile(join(f.execution, 'result.txt'), 'parent result\n'); await f.turn()
    const seed = f.handle.agent.session.snapshotEvents()
    await writeFile(join(f.source, 'host-only.txt'), 'new host input\n')
    const fork = await f.ctx.agents.create({ sessionId: SessionId('fork'), seed, inheritedEventCount: SessionLogOffset(seed.length),
      meta: { cwd: f.source, parentSession: f.handle.agent.id, isSeeded: true }, agentOptions: { provider: 'mock', model: 'main' } })
    const path = await f.executionFor(fork.agent)
    if (path === undefined) throw new Error('fork workspace absent')
    expect(path).not.toBe(f.execution)
    expect(await readFile(join(path, 'result.txt'), 'utf8')).toBe('parent result\n')
    await expect(readFile(join(path, 'host-only.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    await writeFile(join(path, 'result.txt'), 'fork result\n')
    expect(await readFile(join(f.execution, 'result.txt'), 'utf8')).toBe('parent result\n')
    await fork.dispose()
  })

  it('restores the acknowledged repository after RAM loss without reading new host edits', async () => {
    const f = await fixture()
    await writeFile(join(f.execution, 'result.txt'), 'result\n'); await f.turn()
    await f.handle.dispose()
    await rm(f.pool, { recursive: true }); await mkdir(f.pool, { mode: 0o700 })
    await writeFile(join(f.source, 'input.txt'), 'changed on host after conversation\n')
    const resumed = await f.ctx.agents.resume({ resumeSessionId: f.handle.agent.id, agentOptions: { provider: 'mock', model: 'main' } })
    await f.executionFor(resumed.agent)
    expect(await readFile(join(f.pool, 'workspace', 'result.txt'), 'utf8')).toBe('result\n')
    expect(await readFile(join(f.pool, 'workspace', 'input.txt'), 'utf8')).toBe('initial\n')
    await resumed.dispose()
  })
})
