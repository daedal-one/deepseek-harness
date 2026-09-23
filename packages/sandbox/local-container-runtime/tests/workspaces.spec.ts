import { execFile } from 'node:child_process'
import { cp, mkdtemp, mkdir, open, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionStore, { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import ProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import LlmRuntime, { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Commands from '@deepseek-ai/dsh-commands'
import { tryLockExclusive } from '@deepseek-ai/node-addon-system/flock'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import type { LocalContainerRuntime } from '../src/index.ts'
import * as RepoAccessTool from '../src/tool-request-repo-access.ts'
import Workspaces, { type ConversationWorkspaceConfig } from '../src/workspaces.ts'
import type { PodmanControllerExecRequest, PodmanControllerExecResult } from '../src/types.ts'
import { workspaceGit } from '../src/workspace-git.ts'
import * as broker from '../src/workspace-git.ts'
import * as provenance from '../src/workspace-provenance.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
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
  environment?: boolean
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
  const secondSource = join(root, 'second-source')
  if (options.environment === true) {
    await cp(source, secondSource, { recursive: true })
    config.environment = { id: 'test-environment', name: 'Test environment', grantLifetimeMs: 3_600_000,
      repositories: [{ source, url: 'https://github.example/org/first.git', credentialTimeoutMs: 1000 },
        { source: secondSource, url: 'https://github.example/org/second.git', credentialTimeoutMs: 1000, pushCredentialCommand: '/usr/local/bin/scoped-push' }],
      initialGrants: [{ repository: 'https://github.example/org/first.git', access: 'fetch' }] }
  }
  let ctx = new Context()
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
    registerWorkspaceOwner: () => () => {},
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
    await ctx.plugin(UserQuestions)
    await ctx.plugin(LocalStorageWorkspaces, config); await ctx.plugin(AgentLoop, { agents: [] })
  }
  await boot()
  disposers.push(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const adapter = new MockAdapter(options.script ?? [textResponse('Done.'), textResponse('feat: retain changes'), textResponse(JSON.stringify({ HEAD: 'finish-task', 'refs/heads/codex/conversation': 'finish-task' })), textResponse('No further changes.')])
  ctx.llm.registerAdapter(['mock'], adapter)
  const handle = await ctx.agents.create({ sessionId: SessionId(`test-${root.split('/').at(-1)}`), meta: { cwd: source }, agentOptions: { provider: 'mock', model: 'main' } })
  const runtimeForAgent = ctx.agents.withInitiator(handle.agent, () => ctx.conversationWorkspaces.capture())
  const execution = worlds.get(runtimeForAgent)
  if (execution === undefined) throw new Error('missing fixture workspace')
  const turn = async () => {
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Finish the task.' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    return handle.agent.session.snapshotEvents().findLast(event => event.type === 'workspace/state')
  }
  const executionFor = (agent: Agent) => worlds.get(ctx.agents.withInitiator(agent, () => ctx.conversationWorkspaces.capture()))
  const restart = async () => {
    await ctx.fiber.dispose()
    ctx = new Context()
    await boot()
    ctx.llm.registerAdapter(['mock'], adapter)
    return ctx
  }
  return { ctx, root, source, secondSource, pool, recovery, execution, config, handle, turn, adapter, executionFor, restart }
}

describe.skipIf(process.platform === 'win32')('conversation workspace transaction lifecycle', () => {
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

  it('executes repository requests through the model-facing tool and removes them on plugin disposal', async () => {
    const args = { repository: 'https://github.example/org/second.git', access: 'fetch', reason: 'Inspect the second repository requested by the user.' }
    const f = await fixture({ environment: true, script: [toolCallResponse('repo-access', 'request_repo_access', args), textResponse('Attached.')] })
    const plugin = await f.ctx.plugin(RepoAccessTool)
    f.ctx.on('user-questions/request', async ({ questions }) => ({ answers: [{ id: questions[0]!.id, selected: ['Approve'] }] }))
    await f.turn()
    const events = f.handle.agent.session.snapshotEvents()
    const resultEvent = events.find(event => event.type === 'tool/result')
    if (resultEvent?.type !== 'tool/result') throw new Error('missing repository tool result')
    const resultText = resultEvent.data.message.content.find(block => block.type === 'tool-result')?.content.find(block => block.type === 'text')
    expect(JSON.parse(resultText?.text ?? '{}')).toMatchObject({ status: 'ready', repository: args.repository })
    expect(JSON.stringify(events)).toContain('/workspace/repos/')
    const missing = await f.ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('missing-agent'), name: 'request_repo_access', arguments: args })
    expect(missing).toMatchObject({ isError: true })
    expect(JSON.stringify(missing)).toContain('requires an initiating session')
    expect(f.ctx.tools.get('request_repo_access')).toBeDefined()
    await plugin.dispose()
    expect(f.ctx.tools.get('request_repo_access')).toBeUndefined()
  })

  it('retains successful repository returns while another repository fails, then retries only the pending return', async () => {
    const f = await fixture({ environment: true, retryDelayMs: 2_147_483_647 })
    f.ctx.on('user-questions/request', async ({ questions }) => ({ answers: [{ id: questions[0]!.id, selected: ['Approve'] }] }))
    await f.ctx.conversationWorkspaces.requestRepository(f.handle.agent, 'https://github.example/org/second.git', 'fetch', 'Change both repositories.', new AbortController().signal)
    const original = broker.returnWorkspaceBranches
    const returned: string[] = []
    const failure = vi.spyOn(broker, 'returnWorkspaceBranches').mockImplementation(async (...args) => {
      returned.push(args[0])
      if (args[0] === f.secondSource) throw new Error('second destination is unavailable')
      return await original(...args)
    })
    expect((await f.turn())?.data).toMatchObject({ phase: 'pending', repositories: [{ lastTurn: 1 }, { lastTurn: 0 }] })
    expect(returned).toEqual([f.source, f.secondSource])
    failure.mockRestore()
    const retries = vi.spyOn(broker, 'returnWorkspaceBranches')
    const ctx = await f.restart()
    const resumed = await ctx.agents.resume({ resumeSessionId: f.handle.agent.id, agentOptions: { provider: 'mock', model: 'main' } })
    try {
      await expect.poll(() => resumed.agent.session.snapshotEvents().findLast(event => event.type === 'workspace/state')?.data,
        { timeout: 5000 }).toMatchObject({ phase: 'returned', repositories: [{ lastTurn: 1 }, { lastTurn: 1 }] })
      expect(retries.mock.calls.map(args => args[0])).toEqual([f.secondSource])
    } finally { await resumed.dispose() }
  })

  it('restores a multi-repository environment after RAM loss and preserves its grants', async () => {
    const f = await fixture({ environment: true })
    f.ctx.on('user-questions/request', async ({ questions }) => ({ answers: [{ id: questions[0]!.id, selected: ['Approve'] }] }))
    const result = await f.ctx.conversationWorkspaces.requestRepository(f.handle.agent, 'https://github.example/org/second.git', 'fetch', 'Work on the second repository.', new AbortController().signal)
    const relative = result.path!.slice('/workspace/'.length)
    await writeFile(join(f.execution, relative, 'retained.txt'), 'sandbox change\n')
    await f.turn()
    const ctx = await f.restart()
    await rm(join(f.pool, 'workspace'), { recursive: true }); await rm(join(f.pool, 'owner.json'))
    await writeFile(join(f.secondSource, 'input.txt'), 'new host change\n')
    const resumed = await ctx.agents.resume({ resumeSessionId: f.handle.agent.id, agentOptions: { provider: 'mock', model: 'main' } })
    try {
      const world = f.executionFor(resumed.agent)!
      expect(await readFile(join(world, relative, 'retained.txt'), 'utf8')).toBe('sandbox change\n')
      expect(await readFile(join(world, relative, 'input.txt'), 'utf8')).toBe('initial\n')
      expect((await ctx.conversationWorkspaces.requestRepository(resumed.agent, 'https://github.example/org/second.git', 'fetch', 'Reuse access.', new AbortController().signal)).status).toBe('ready')
    } finally { await resumed.dispose() }
  })

  it('recovers an attachment interrupted after its physical import but before its checkpoint', async () => {
    const f = await fixture({ environment: true })
    f.ctx.on('user-questions/request', async ({ questions }) => ({ answers: [{ id: questions[0]!.id, selected: ['Approve'] }] }))
    const publish = broker.publishWorkspaceJson
    const failure = vi.spyOn(broker, 'publishWorkspaceJson').mockImplementation(async (path, value, bound) => {
      if (path.includes('/checkpoint-')) throw new Error('injected checkpoint failure')
      await publish(path, value, bound)
    })
    const result = await f.ctx.conversationWorkspaces.requestRepository(f.handle.agent, 'https://github.example/org/second.git', 'fetch', 'Attach the second repository.', new AbortController().signal)
    expect(result.status).toBe('approved_pending')
    expect(result.path).toBeUndefined()
    const retry = await f.ctx.conversationWorkspaces.requestRepository(f.handle.agent, result.repository, 'fetch', 'Retry before recovery.', new AbortController().signal)
    expect(retry).toMatchObject({ status: 'approved_pending' })
    expect(retry.path).toBeUndefined()
    failure.mockRestore()
    const ctx = await f.restart()
    const resumed = await ctx.agents.resume({ resumeSessionId: f.handle.agent.id, agentOptions: { provider: 'mock', model: 'main' } })
    try {
      const attached = await ctx.conversationWorkspaces.requestRepository(resumed.agent, 'https://github.example/org/second.git', 'fetch', 'Resume attachment.', new AbortController().signal)
      expect(attached.status).toBe('ready')
      expect(await readFile(join(f.executionFor(resumed.agent)!, attached.path!.slice('/workspace/'.length), 'input.txt'), 'utf8')).toBe('initial\n')
    } finally { await resumed.dispose() }
  })

  it('attaches two repositories after explicit approval and retains environment authority across sessions', async () => {
    const f = await fixture({ environment: true })
    const requests: string[] = []
    f.ctx.on('user-questions/request', async ({ questions }) => {
      requests.push(questions[0]!.detail!)
      return { answers: [{ id: questions[0]!.id, selected: ['Approve'] }] }
    })
    const repository = 'https://github.example/org/second.git'
    const request = () => f.ctx.conversationWorkspaces.requestRepository(f.handle.agent, repository, 'fetch', 'Compare both repositories.', new AbortController().signal)
    const result = await request()
    expect(result.status).toBe('ready')
    expect(result.path).toMatch(/^\/workspace\/repos\/[a-f0-9]{16}$/u)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toContain('every session attached to this environment')
    const firstPath = f.ctx.agents.withInitiator(f.handle.agent, () => f.ctx.conversationWorkspaces.executionPath(f.source))
    const secondPath = join(f.execution, result.path!.slice('/workspace/'.length))
    await writeFile(join(f.execution, firstPath.slice('/workspace/'.length), 'first-change.txt'), 'first\n')
    await writeFile(join(secondPath, 'second-change.txt'), 'second\n')
    expect((await f.turn())?.data).toMatchObject({ phase: 'returned', environmentId: 'test-environment', repositories: [{ lastTurn: 1 }, { lastTurn: 1 }] })
    expect((await workspaceGit(f.secondSource, ['for-each-ref', '--format=%(refname)', 'refs/heads/dsh/'], f.config)).toString()).not.toBe('')
    await request()
    expect(requests).toHaveLength(1)
    const originalWorld = f.executionFor(f.handle.agent)
    const id = f.handle.agent.id
    await f.handle.dispose()
    const resumed = await f.ctx.agents.resume({ resumeSessionId: id, agentOptions: { provider: 'mock', model: 'main' } })
    expect(f.executionFor(resumed.agent)).toBe(originalWorld)
    const other = await f.ctx.agents.create({ sessionId: SessionId('another-environment-session'), meta: { cwd: f.source }, agentOptions: { provider: 'mock', model: 'main' } })
    try {
      const attached = await f.ctx.conversationWorkspaces.requestRepository(other.agent, repository, 'fetch', 'Use the already approved repository.', new AbortController().signal)
      expect(attached.status).toBe('ready')
      expect(requests).toHaveLength(1)
      expect(f.executionFor(other.agent)).not.toBe(originalWorld)
      expect(f.executionFor(resumed.agent)).toBe(originalWorld)
    } finally { await other.dispose(); await resumed.dispose() }
  })

  it('denies ambiguous and rejected repository approvals and asks again for push escalation', async () => {
    const f = await fixture({ environment: true })
    let selected = ['Deny']; let custom: string | undefined
    const answerer = f.ctx.on('user-questions/request', async ({ questions }) => ({ answers: [{ id: questions[0]!.id, selected,
      ...custom === undefined ? {} : { custom } }] }))
    const repository = 'https://github.example/org/second.git'
    const request = (access: 'fetch' | 'push') => f.ctx.conversationWorkspaces.requestRepository(f.handle.agent, repository, access, 'Requested comparison.', new AbortController().signal)
    expect((await request('fetch')).status).toBe('denied')
    selected = ['Approve']; custom = 'Only if another condition holds'
    expect((await request('fetch')).status).toBe('denied')
    custom = undefined
    expect((await request('fetch')).status).toBe('ready')
    selected = ['Deny']
    expect((await request('push')).status).toBe('denied')
    const durable = JSON.parse(await readFile(join(f.recovery, 'environments/test-environment/environment-access.json'), 'utf8')) as { grants: Array<{ repository: string; access: string }> }
    expect(durable.grants.find(grant => grant.repository === repository)?.access).toBe('fetch')
    answerer()
  })

  it('releases the environment lease after stopped worlds retain a failed checkpoint', async () => {
    const f = await fixture({ environment: true })
    const publish = broker.publishWorkspaceJson
    vi.spyOn(broker, 'publishWorkspaceJson').mockImplementation(async (path, value, bound) => {
      if (path.includes('/checkpoint-')) throw new Error('injected shutdown checkpoint failure')
      await publish(path, value, bound)
    })
    await f.ctx.fiber.dispose()
    const lease = await open(join(f.recovery, 'environments/test-environment/lease'), 'a+')
    try { await tryLockExclusive(lease.fd) } finally { await lease.close() }
    expect(JSON.parse(await readFile(join(f.pool, 'owner.json'), 'utf8'))).toMatchObject({ clean: false })
  })

  it('cancels and joins a pending human approval before releasing workspace storage', async () => {
    const f = await fixture({ environment: true })
    let entered!: () => void
    const ready = new Promise<void>((resolve) => { entered = resolve })
    f.ctx.on('user-questions/request', async ({ signal }) => {
      entered()
      return await new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => { reject(new Error('approval cancelled')) }, { once: true })
      })
    })
    const request = f.ctx.conversationWorkspaces.requestRepository(f.handle.agent, 'https://github.example/org/second.git', 'fetch', 'Compare repositories.', new AbortController().signal)
    const rejected = expect(request).rejects.toThrow()
    await ready
    await f.ctx.fiber.dispose()
    await rejected
    const record = JSON.parse(await readFile(join(f.recovery, 'environments/test-environment/environment-access.json'), 'utf8')) as { revision: number }
    expect(record.revision).toBe(1)
    expect(JSON.parse(await readFile(join(f.pool, 'owner.json'), 'utf8'))).toMatchObject({ clean: true })
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
      await f.handle.dispose()
      // Reconstruct the exact durable bytes at the interruption, excluding orderly-shutdown publications.
      await rm(directory, { recursive: true }); await cp(crashImage, directory, { recursive: true })
      const resumed = await f.ctx.agents.resume({ resumeSessionId: f.handle.agent.id,
        agentOptions: { provider: 'mock', model: 'main' } })
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
    const execution = f.executionFor(resumed.agent)
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
    await expect(f.ctx.agents.resume({ resumeSessionId: f.handle.agent.id,
      agentOptions: { provider: 'mock', model: 'main' } })).rejects.toThrow('integrity')
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
    expect(await readFile(join(f.pool, 'workspace', 'unfinished.txt'), 'utf8')).toBe('partial work\n')
    await resumed.dispose()
  })

  it('shares the parent repository with a child but returns branches only when the parent settles', async () => {
    const f = await fixture()
    const child = await f.ctx.agents.create({ sessionId: SessionId('child'), parentAgent: f.handle.agent,
      meta: { cwd: f.source }, agentOptions: { provider: 'mock', model: 'main' } })
    expect(f.executionFor(child.agent)).toBe(f.execution)
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
    const path = f.executionFor(fork.agent)
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
    expect(await readFile(join(f.pool, 'workspace', 'result.txt'), 'utf8')).toBe('result\n')
    expect(await readFile(join(f.pool, 'workspace', 'input.txt'), 'utf8')).toBe('initial\n')
    await resumed.dispose()
  })
})
