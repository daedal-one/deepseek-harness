/**
 * Forge session adapter for DeepSeek Harness. Forge owns lifecycle and the
 * pre-allocated executor; this plugin owns protocol translation and exposes
 * only Forge Intellect action tools inside each agent scope.
 * @module @deepseek-ai/dsh-forge-session-adapter
 */

import { randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { grantArgs, launcherPath, probe } from '@deepseek-ai/node-addon-landlock-run'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  FORGE_ACTION_TOOLS_PROTOCOL,
  FORGE_COMMANDS,
  FORGE_EVIDENCE_PROTOCOL,
  FORGE_SESSION_PROTOCOL,
  ProtocolError,
  parseCommandRequest,
  parseStartPayload,
  stableUuid,
  type ForgeAdapterEvent,
  type ForgeCommandRequest,
  type ForgeCommandResponse,
  type ForgeOutcome,
  type ExecutorPolicy,
  type StartPayload,
} from './protocol.ts'

export * from './protocol.ts'

const INTELLECT_TOOLS = [
  'workspace_read',
  'workspace_apply',
  'workspace_run',
  'workspace_reconcile',
  'workspace_watermarks',
] as const
const INTELLECT_SERVER_NAME = 'forge_intellect'
const PUBLIC_TOOL_PREFIX = `mcp__${INTELLECT_SERVER_NAME}__`
const MAX_RETAINED_EVENTS = 2_000
const MAX_IDEMPOTENCY_RESPONSES = 128

/** Cordis services required by the Forge session adapter. */
export const inject = ['agents', 'sessionPersistence', 'tools', 'webServer']

/** Runtime configuration for the authenticated Forge session bridge. */
export interface Config {
  /** Deployment token required in X-Forge-Adapter-Token on every adapter route. */
  token: string
  /** Absolute private JSON file retaining adapter sequencing and idempotency. */
  stateFile: string
  /** Route prefix; Forge's shipped registry uses `/v1`. */
  routePrefix: string
  /** Maximum accepted JSON request bytes. */
  maxRequestBytes: number
  /** Forge Intellect action MCP executable. */
  intellectCommand: string
  /** Reviewed launcher arguments placed before action-MCP arguments. */
  intellectCommandPrefixArgs: string[]
  /** Private retained ledger root, outside executor workspaces. */
  intellectStateRoot: string
  /** Forge Intellect graph database path. */
  intellectGraphDb: string
  /** Extra paths hidden from the accountable workspace gateway. */
  intellectExcludes: string[]
  /** Timeout for each action-tool call. */
  intellectToolCallTimeoutMs: number
  /** Root containing Forge-owned per-lease SSH-agent sockets. */
  credentialSocketRoot: string
  /** Child-command confinement mechanism. */
  commandSandbox: 'disabled' | 'landlock'
  /** Runtime roots visible read-only to confined commands. */
  commandReadRoots: string[]
}

export const Config: z<Config> = z.object({
  token: z.string().required(),
  stateFile: z.string().required(),
  routePrefix: z.string().default('/v1'),
  maxRequestBytes: z.number().min(1).max(16 * 1024 * 1024).default(1024 * 1024),
  intellectCommand: z.string().default('forge-intellect-action-mcp'),
  intellectCommandPrefixArgs: z.array(String).default([]),
  intellectStateRoot: z.string().required(),
  intellectGraphDb: z.string().required(),
  intellectExcludes: z.array(String).default(['.git']),
  intellectToolCallTimeoutMs: z.number().min(1).default(60_000),
  credentialSocketRoot: z.string().default('/run/forge-agent-credentials'),
  commandSandbox: z.union(['disabled', 'landlock'] as const).default('disabled'),
  commandReadRoots: z.array(String).default(['/usr', '/bin', '/lib', '/lib64', '/etc']),
})

interface StoredSession {
  sessionId: string
  projectId: string
  workId: string
  intentRevision: string
  causalityId: string
  workspace: string
  executorPolicy: ExecutorPolicy
  started: boolean
  closed: boolean
  nextSequence: number
  llm?: StartPayload['llm']
  idempotency: Record<string, ForgeCommandResponse>
  idempotencyOrder: string[]
}

interface StoredState {
  protocol: 'dsh-forge-session-adapter-state/v1'
  sessions: Record<string, StoredSession>
}

interface PendingApproval {
  id: string
  resolve: (outcome: ApprovalOutcome) => void
}

interface LiveSession {
  stored: StoredSession
  handle?: AgentHandle
  events: ForgeAdapterEvent[]
  tail: Promise<void>
  pendingApproval?: PendingApproval
  approvalBoundary: PromiseWithResolvers<void>
  commandTempRoot?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    forgeSessionAdapter: ForgeSessionAdapter
  }
}

function initialState(): StoredState {
  return { protocol: 'dsh-forge-session-adapter-state/v1', sessions: {} }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function safeEqual(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false
  const left = Buffer.from(actual)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(bytes.length),
    'cache-control': 'no-store',
  })
  res.end(bytes)
}

function eventType(event: SessionEvent): string {
  if (event.type === 'user/message') return 'message.accepted'
  if (event.type === 'assistant/message') return 'message.completed'
  if (event.type === 'tool/call') return 'tool.requested'
  if (event.type === 'tool/result') return 'tool.completed'
  if (event.type === 'approval/asked') return 'approval.requested'
  if (event.type === 'approval/decided') return 'approval.decided'
  if (event.type === 'turn/start') return 'turn.started'
  if (event.type === 'turn/end') return 'turn.completed'
  return `deepseek.${event.type.replaceAll('/', '.')}`
}

/** Forge protocol bridge and owner of all adapter-created agent handles. */
export class ForgeSessionAdapter extends Service {
  static Config = Config
  static inject = inject

  private readonly sessions = new Map<string, LiveSession>()
  private state: StoredState = initialState()
  private stateTail: Promise<void> = Promise.resolve()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'forgeSessionAdapter')
    this.validateConfig()
  }

  async [Service.init](): Promise<void> {
    await this.loadState()
    const unregisterCapabilities = this.ctx.webServer.register({
      kind: 'exact', path: `${this.config.routePrefix}/capabilities`,
      handler: (req, res) => { this.capabilities(req, res) },
    })
    const unregisterSessions = this.ctx.webServer.register({
      kind: 'prefix', path: `${this.config.routePrefix}/sessions`,
      handler: (req, res) => this.sessionsRoute(req, res),
    })
    const offEvent = this.ctx.on('session/event', (session, event) => {
      const record = this.sessions.get(String(session.id))
      if (record !== undefined) this.append(record, eventType(event), { native_event: event })
    })
    const offStatus = this.ctx.on('agent/status', ({ agent, status }) => {
      const record = this.sessions.get(String(agent.id))
      if (record !== undefined) this.append(record, `session.${status}`, { status })
    })
    this.ctx.effect(() => async () => {
      unregisterCapabilities()
      unregisterSessions()
      offEvent()
      offStatus()
      const records = [...this.sessions.values()]
      const handles = records.flatMap(record => record.handle === undefined ? [] : [record.handle])
      await Promise.allSettled(handles.map(handle => handle.dispose()))
      await Promise.allSettled(records.flatMap(record => record.commandTempRoot === undefined
        ? []
        : [rm(record.commandTempRoot, { recursive: true, force: true })]))
      await this.stateTail
    }, 'forgeSessionAdapter.lifecycle')
  }

  /**
   * Current protocol capability document, also served over HTTP.
   * @returns The immutable Forge adapter capability declaration.
   */
  capability(): Record<string, unknown> {
    return {
      harness: 'deepseek-harness',
      adapter: 'deepseek-harness-forge-adapter/v1',
      available: true,
      protocols: [FORGE_SESSION_PROTOCOL],
      commands: [...FORGE_COMMANDS],
      checkpoint_support: true,
      approval_semantics: 'explicit-allow-deny',
      evidence_protocol: FORGE_EVIDENCE_PROTOCOL,
      action_tools_protocol: FORGE_ACTION_TOOLS_PROTOCOL,
      limitations: [
        'pause and resume commands are not advertised',
        'the adapter requires a Forge-allocated executor workspace',
      ],
    }
  }

  private validateConfig(): void {
    if (this.config.token.length < 16) throw new Error('forge-session-adapter: token must contain at least 16 characters')
    const paths: readonly (readonly [string, string])[] = [
      ['stateFile', this.config.stateFile],
      ['intellectStateRoot', this.config.intellectStateRoot],
      ['intellectGraphDb', this.config.intellectGraphDb],
      ['credentialSocketRoot', this.config.credentialSocketRoot],
    ]
    for (const [label, value] of paths) {
      if (!value.startsWith('/')) throw new Error(`forge-session-adapter: ${label} must be absolute`)
    }
    if (!/^\/[A-Za-z0-9._/-]+$/.test(this.config.credentialSocketRoot)) {
      throw new Error('forge-session-adapter: credentialSocketRoot contains unsafe characters')
    }
    if (!/^\/[A-Za-z0-9._/-]*[A-Za-z0-9._-]$/.test(this.config.routePrefix)) {
      throw new Error('forge-session-adapter: routePrefix must be an absolute path without a trailing slash')
    }
    if (new Set(this.config.intellectExcludes).size !== this.config.intellectExcludes.length) {
      throw new Error('forge-session-adapter: intellectExcludes must be unique')
    }
    if (this.config.commandReadRoots.some(path => !path.startsWith('/'))) {
      throw new Error('forge-session-adapter: commandReadRoots must be absolute')
    }
    if (this.config.commandSandbox === 'landlock' && probe() === 'unusable') {
      throw new Error('forge-session-adapter: Landlock command sandbox is unavailable')
    }
  }

  private async loadState(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.config.stateFile, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null
        || (parsed as { protocol?: unknown }).protocol !== 'dsh-forge-session-adapter-state/v1') {
        throw new Error('unsupported adapter state')
      }
      this.state = parsed as StoredState
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.state = initialState()
    }
    for (const stored of Object.values(this.state.sessions)) {
      this.sessions.set(stored.sessionId, {
        stored,
        events: [],
        tail: Promise.resolve(),
        approvalBoundary: Promise.withResolvers<void>(),
      })
    }
  }

  private persist(): Promise<void> {
    const write = this.stateTail.then(() => writeFileAtomic(
      this.config.stateFile,
      `${JSON.stringify(this.state, null, 2)}\n`,
      { mode: 0o600, dirMode: 0o700 },
    ))
    this.stateTail = write.catch(() => undefined)
    return write
  }

  private authorized(req: IncomingMessage): boolean {
    const header = req.headers['x-forge-adapter-token']
    const token = typeof header === 'string' ? header : undefined
    return safeEqual(token, this.config.token)
  }

  private capabilities(req: IncomingMessage, res: ServerResponse): void {
    if (!this.authorized(req)) {
      json(res, 401, { error: 'unauthorized' })
      return
    }
    if (req.method !== 'GET') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    json(res, 200, this.capability())
  }

  private async sessionsRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.authorized(req)) {
      json(res, 401, { error: 'unauthorized' })
      return
    }
    const path = new URL(req.url ?? '/', 'http://adapter.invalid').pathname
    const escaped = this.config.routePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(`^${escaped}/sessions/([^/]+)(?:/(commands))?$`).exec(path)
    const encodedSessionId = match?.[1]
    if (encodedSessionId === undefined) {
      json(res, 404, { error: 'not found' })
      return
    }
    const sessionId = decodeURIComponent(encodedSessionId)
    const commandSuffix = match?.[2]
    try {
      if (req.method === 'GET' && commandSuffix === undefined) {
        const record = this.sessions.get(sessionId)
        if (record === undefined) {
          json(res, 404, { error: 'session not found' })
          return
        }
        json(res, 200, this.inspectBody(record))
        return
      }
      if (req.method !== 'POST' || commandSuffix !== 'commands') {
        json(res, 405, { error: 'method not allowed' })
        return
      }
      const command = parseCommandRequest(await this.readJson(req))
      if (command.session_id !== sessionId) throw new ProtocolError('path and body session ids differ', 409)
      const response = await this.dispatch(command)
      json(res, 200, response)
    } catch (error) {
      const failure = error instanceof ProtocolError ? error : new ProtocolError(asError(error).message, 500, 'failed')
      json(res, failure.statusCode, { error: failure.message, outcome: failure.outcome })
    }
  }

  private async readJson(req: IncomingMessage): Promise<unknown> {
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of req as AsyncIterable<unknown>) {
      const bytes = typeof chunk === 'string'
        ? Buffer.from(chunk)
        : chunk instanceof Uint8Array
          ? chunk
          : undefined
      if (bytes === undefined) throw new ProtocolError('request body contains unsupported bytes')
      size += bytes.length
      if (size > this.config.maxRequestBytes) throw new ProtocolError('request body is too large', 413)
      chunks.push(bytes)
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    } catch {
      throw new ProtocolError('request body must be valid JSON')
    }
  }

  private dispatch(request: ForgeCommandRequest): Promise<ForgeCommandResponse> {
    let record = this.sessions.get(request.session_id)
    if (record === undefined) {
      if (request.command !== 'start') throw new ProtocolError('session has not been started', 404)
      record = this.createRecord(request)
    }
    const activeRecord = record
    this.assertIdentity(activeRecord, request)
    const cached = activeRecord.stored.idempotency[request.idempotency_key]
    if (cached !== undefined) return Promise.resolve(cached)
    if (request.command === 'approve') return this.executeAndRemember(activeRecord, request)
    const result = activeRecord.tail.then(() => this.executeAndRemember(activeRecord, request))
    activeRecord.tail = result.then(() => undefined, () => undefined)
    return result
  }

  private createRecord(request: ForgeCommandRequest): LiveSession {
    const stored: StoredSession = {
      sessionId: request.session_id,
      projectId: request.project_id,
      workId: request.work_id,
      intentRevision: request.intent_revision,
      causalityId: request.causality_id,
      workspace: request.executor_policy.workspace,
      executorPolicy: {
        ...request.executor_policy,
        tools: [...request.executor_policy.tools],
        credential_scopes: [...request.executor_policy.credential_scopes],
      },
      started: false,
      closed: false,
      nextSequence: 1,
      idempotency: {},
      idempotencyOrder: [],
    }
    const record: LiveSession = {
      stored,
      events: [],
      tail: Promise.resolve(),
      approvalBoundary: Promise.withResolvers<void>(),
    }
    this.sessions.set(stored.sessionId, record)
    this.state.sessions[stored.sessionId] = stored
    return record
  }

  private assertIdentity(record: LiveSession, request: ForgeCommandRequest): void {
    const stored = record.stored
    if (stored.projectId !== request.project_id || stored.workId !== request.work_id
      || stored.intentRevision !== request.intent_revision || stored.causalityId !== request.causality_id
      || stored.workspace !== request.executor_policy.workspace
      || stored.executorPolicy.max_minutes !== request.executor_policy.max_minutes
      || stored.executorPolicy.network !== request.executor_policy.network
      || stored.executorPolicy.tools.join('\0') !== request.executor_policy.tools.join('\0')
      || stored.executorPolicy.credential_scopes.join('\0') !== request.executor_policy.credential_scopes.join('\0')
      || stored.executorPolicy.executor_lease_id !== request.executor_policy.executor_lease_id) {
      throw new ProtocolError('session identity or allocated workspace changed', 409, 'policy_denied')
    }
    if (stored.closed) throw new ProtocolError('session is closed', 409)
  }

  private async executeAndRemember(record: LiveSession, request: ForgeCommandRequest): Promise<ForgeCommandResponse> {
    const startSequence = record.stored.nextSequence
    let response: ForgeCommandResponse
    try {
      response = await this.execute(record, request, startSequence)
    } catch (error) {
      const failure = error instanceof ProtocolError ? error : new ProtocolError(asError(error).message, 500, 'failed')
      this.append(record, 'command.failed', { command: request.command, error: failure.message })
      response = {
        status: 'failed',
        outcome: failure.outcome,
        events: this.eventsFrom(record, startSequence),
      }
    }
    record.stored.idempotency[request.idempotency_key] = response
    record.stored.idempotencyOrder.push(request.idempotency_key)
    while (record.stored.idempotencyOrder.length > MAX_IDEMPOTENCY_RESPONSES) {
      const evicted = record.stored.idempotencyOrder.shift()
      if (evicted !== undefined) {
        const { [evicted]: ignored, ...retained } = record.stored.idempotency
        void ignored
        record.stored.idempotency = retained
      }
    }
    await this.persist()
    return response
  }

  private async execute(
    record: LiveSession,
    request: ForgeCommandRequest,
    startSequence: number,
  ): Promise<ForgeCommandResponse> {
    if (request.command === 'start') return this.start(record, request, startSequence)
    const agent = await this.ensureHandle(record)
    if (request.command === 'approve') return this.approve(record, request, startSequence)
    if (request.command === 'send' || request.command === 'queue') {
      agent.followup(createUserMessage({ content: [{ type: 'text', text: this.payloadText(request) }], source: { kind: 'user' } }))
      await this.waitForBoundary(record, agent)
    } else if (request.command === 'steer') {
      agent.steer(createUserMessage({ content: [{ type: 'text', text: this.payloadText(request) }], source: { kind: 'user' } }))
      await this.waitForBoundary(record, agent)
    } else if (request.command === 'checkpoint') {
      const evidence = await this.action(record, 'workspace_watermarks', {})
      this.append(record, 'checkpoint.created', { evidence })
      return this.response(record, startSequence, 'idle', undefined, evidence)
    } else if (request.command === 'diff') {
      const evidence = await this.action(record, 'workspace_run', {
        command: {
          argv: ['git', 'diff', '--no-ext-diff', '--binary', '--', '.'],
          working_directory: null,
          output_limit: 4 * 1024 * 1024,
          timeout_millis: 60_000,
        },
        action: {
          message: 'Forge requested an accountable workspace diff',
          details: { forge_adapter_command: 'diff', causality_id: record.stored.causalityId },
        },
      })
      this.append(record, 'diff.created', { evidence })
      return this.response(record, startSequence, 'idle', undefined, evidence)
    } else if (request.command === 'inspect') {
      this.append(record, 'session.inspected', this.inspectBody(record))
    } else if (request.command === 'cancel') {
      this.cancelApproval(record)
      agent.cancel({ kind: 'user' })
      await agent.whenIdle()
      this.append(record, 'session.cancelled', {})
      return this.response(record, startSequence, 'terminal', 'cancelled')
    } else {
      return this.close(record, startSequence)
    }
    return this.response(record, startSequence, this.status(record))
  }

  private async start(
    record: LiveSession,
    request: ForgeCommandRequest,
    startSequence: number,
  ): Promise<ForgeCommandResponse> {
    if (record.stored.started) throw new ProtocolError('session is already started', 409)
    const payload = parseStartPayload(request)
    const canonicalWorkspace = await realpath(record.stored.workspace)
    if (canonicalWorkspace !== record.stored.workspace) {
      throw new ProtocolError('allocated workspace must be canonical', 409, 'policy_denied')
    }
    record.stored.llm = payload.llm
    const agent = await this.ensureHandle(record)
    record.stored.started = true
    agent.inject(createUserMessage({
      content: [{
        type: 'text',
        text: [
          'Forge accepted the following durable intent at the exact allocated workspace revision.',
          `Work: ${record.stored.workId}`,
          `Target: ${payload.intent.target}`,
          `Revision: ${payload.intent.workspace_revision}`,
          `Forge Intellect preflight action: ${payload.intent.evidence.action_id}`,
          '',
          payload.intent.rendered,
        ].join('\n'),
      }],
      source: { kind: 'plugin', plugin: 'forge-session-adapter' },
    }))
    this.append(record, 'session.started', {
      work_id: record.stored.workId,
      intent_revision: record.stored.intentRevision,
      preflight: payload.intent.evidence,
    })
    if (payload.prompt !== undefined) {
      agent.followup(createUserMessage({ content: [{ type: 'text', text: payload.prompt }], source: { kind: 'user' } }))
      await this.waitForBoundary(record, agent)
    }
    return this.response(record, startSequence, this.status(record))
  }

  private async ensureHandle(record: LiveSession): Promise<Agent> {
    const current = record.handle?.agent
    if (current !== undefined && this.ctx.agents.get(current.id) === current) return current
    const credentialEnvironment: Record<string, string> = {}
    const commandArguments: string[] = []
    if (record.stored.executorPolicy.credential_scopes.includes('forgejo:project:write')) {
      const credentialDirectory = join(
        this.config.credentialSocketRoot,
        record.stored.executorPolicy.executor_lease_id,
      )
      const socket = join(credentialDirectory, 'agent.sock')
      const knownHosts = join(credentialDirectory, 'known_hosts')
      const [socketMetadata, knownHostsMetadata] = await Promise.all([
        lstat(socket).catch(() => undefined),
        lstat(knownHosts).catch(() => undefined),
      ])
      if (socketMetadata?.isSocket() !== true || knownHostsMetadata?.isFile() !== true) {
        throw new ProtocolError('Forge workload credential socket is unavailable', 409, 'policy_denied')
      }
      credentialEnvironment.SSH_AUTH_SOCK = socket
      credentialEnvironment.GIT_SSH_COMMAND = [
        'ssh',
        '-oBatchMode=yes',
        '-oStrictHostKeyChecking=yes',
        `-oUserKnownHostsFile=${knownHosts}`,
      ].join(' ')
    }
    if (this.config.commandSandbox === 'landlock') {
      const commandTempRoot = join('/tmp', `forge-${record.stored.executorPolicy.executor_lease_id}`)
      await mkdir(commandTempRoot, { recursive: true, mode: 0o700 })
      if (await realpath(commandTempRoot) !== commandTempRoot) {
        throw new ProtocolError('Forge command temporary directory must be canonical', 409, 'policy_denied')
      }
      await chmod(commandTempRoot, 0o700)
      record.commandTempRoot = commandTempRoot
      credentialEnvironment.TMPDIR = commandTempRoot
      credentialEnvironment.TMP = commandTempRoot
      credentialEnvironment.TEMP = commandTempRoot
      const readWrite = ['/dev/null', commandTempRoot, record.stored.workspace]
      if (credentialEnvironment.SSH_AUTH_SOCK !== undefined) {
        readWrite.push(credentialEnvironment.SSH_AUTH_SOCK)
      }
      const readOnly = [...this.config.commandReadRoots]
      if (credentialEnvironment.GIT_SSH_COMMAND !== undefined) {
        readOnly.push(join(
          this.config.credentialSocketRoot,
          record.stored.executorPolicy.executor_lease_id,
          'known_hosts',
        ))
      }
      commandArguments.push(
        '--command-wrapper-json',
        JSON.stringify([
          launcherPath(),
          ...grantArgs({ readOnly, readWrite }),
          '--',
        ]),
        '--command-clear-env',
      )
      if (credentialEnvironment.SSH_AUTH_SOCK !== undefined) {
        commandArguments.push(
          '--command-inherit-env', 'SSH_AUTH_SOCK',
          '--command-inherit-env', 'GIT_SSH_COMMAND',
        )
      }
      commandArguments.push(
        '--command-inherit-env', 'TMPDIR',
        '--command-inherit-env', 'TMP',
        '--command-inherit-env', 'TEMP',
      )
    }
    const setup = async (agentCtx: Context): Promise<void> => {
      await agentCtx.plugin(McpClient, {
        transport: 'stdio',
        serverName: INTELLECT_SERVER_NAME,
        command: this.config.intellectCommand,
        args: [
          ...this.config.intellectCommandPrefixArgs,
          '--workspace-root', record.stored.workspace,
          '--state-root', this.config.intellectStateRoot,
          '--graph-db', this.config.intellectGraphDb,
          '--workspace', stableUuid(`forge-workspace:${record.stored.projectId}:${record.stored.workspace}`),
          '--session', stableUuid(`forge-session:${record.stored.sessionId}`),
          '--actor', 'agent:deepseek-harness',
          ...this.config.intellectExcludes.flatMap(path => ['--exclude', path]),
          ...commandArguments,
        ],
        env: credentialEnvironment,
        cwd: record.stored.workspace,
        toolCallTimeoutMs: this.config.intellectToolCallTimeoutMs,
        processGraceMs: 2_000,
        failOnStartupError: true,
        includeTools: [...INTELLECT_TOOLS],
        clientLifetime: 'plugin',
      })
      agentCtx.on('tools/pre-execute', (exec, next) => this.authorizeActionTool(record, exec, next))
      agentCtx.on('approval/request', approval => this.requestApproval(record, approval))
    }
    const options = {
      agentOptions: {
        ...record.stored.llm?.provider === undefined ? {} : { provider: record.stored.llm.provider },
        ...record.stored.llm?.model === undefined ? {} : { model: record.stored.llm.model },
        ...record.stored.llm?.max_tokens === undefined ? {} : { maxTokens: record.stored.llm.max_tokens },
      },
      setup,
    }
    let handle: AgentHandle
    if (record.stored.started) {
      handle = await this.ctx.agents.resume({ resumeSessionId: SessionId(record.stored.sessionId), ...options })
    } else {
      try {
        handle = await this.ctx.agents.create({
          sessionId: SessionId(record.stored.sessionId),
          meta: { cwd: record.stored.workspace },
          ...options,
        })
      } catch (error) {
        if (!/already exists/i.test(asError(error).message)) throw error
        handle = await this.ctx.agents.resume({ resumeSessionId: SessionId(record.stored.sessionId), ...options })
      }
    }
    record.handle = handle
    return handle.agent
  }

  private authorizeActionTool(
    record: LiveSession,
    exec: ToolExecution,
    next: () => Promise<{ kind: 'allow' } | { kind: 'deny'; reason: string } | { kind: 'ask'; reason?: string }>,
  ): Promise<{ kind: 'allow' } | { kind: 'deny'; reason: string } | { kind: 'ask'; reason?: string }> {
    if (!exec.name.startsWith(PUBLIC_TOOL_PREFIX)) return next()
    const rawName = exec.name.slice(PUBLIC_TOOL_PREFIX.length)
    if (!INTELLECT_TOOLS.includes(rawName as typeof INTELLECT_TOOLS[number])) {
      return Promise.resolve({ kind: 'deny', reason: 'tool is outside the Forge Intellect action protocol' })
    }
    if (rawName === 'workspace_apply') {
      if (!record.stored.executorPolicy.tools.includes('workspace_apply')) {
        return Promise.resolve({ kind: 'deny', reason: 'executor policy does not grant workspace_apply' })
      }
      return Promise.resolve({ kind: 'ask', reason: 'Forge policy requires approval for accountable workspace mutations' })
    }
    if (rawName === 'workspace_run') {
      const arguments_ = exec.arguments as {
        command?: { argv?: unknown }
        action?: { details?: { forge_adapter_command?: unknown } }
      }
      const argv = arguments_.command?.argv
      const program = Array.isArray(argv) && typeof argv[0] === 'string' ? argv[0] : undefined
      if (program === undefined || !record.stored.executorPolicy.tools.includes(program)) {
        return Promise.resolve({ kind: 'deny', reason: 'command executable is outside the executor policy' })
      }
      const details = arguments_.action?.details
      if (details?.forge_adapter_command === 'diff') return next()
      return Promise.resolve({ kind: 'ask', reason: 'Forge policy requires approval for accountable workspace commands' })
    }
    return next()
  }

  private requestApproval(record: LiveSession, request: ApprovalRequest): Promise<ApprovalOutcome> {
    if (record.pendingApproval !== undefined) return Promise.resolve('unavailable')
    const id = randomUUID()
    const outcome = Promise.withResolvers<ApprovalOutcome>()
    record.pendingApproval = { id, resolve: outcome.resolve }
    this.append(record, 'approval.requested', {
      approval_id: id,
      tool_name: request.toolName,
      ...request.reason === undefined ? {} : { reason: request.reason },
    })
    record.approvalBoundary.resolve()
    return outcome.promise
  }

  private async approve(
    record: LiveSession,
    request: ForgeCommandRequest,
    startSequence: number,
  ): Promise<ForgeCommandResponse> {
    const pending = record.pendingApproval
    if (pending === undefined) throw new ProtocolError('session has no pending approval', 409)
    const approvalId = request.payload.approval_id
    if (approvalId !== pending.id) throw new ProtocolError('approval_id does not match the pending request', 409)
    const decision = request.payload.decision
    if (decision !== 'allow' && decision !== 'deny') throw new ProtocolError('approval decision must be allow or deny')
    delete record.pendingApproval
    record.approvalBoundary = Promise.withResolvers<void>()
    this.append(record, 'approval.answered', { approval_id: pending.id, decision })
    pending.resolve(decision === 'allow' ? 'allowed-once' : 'rejected')
    const agent = await this.ensureHandle(record)
    await this.waitForBoundary(record, agent)
    return this.response(record, startSequence, this.status(record))
  }

  private cancelApproval(record: LiveSession): void {
    const pending = record.pendingApproval
    if (pending === undefined) return
    delete record.pendingApproval
    record.approvalBoundary = Promise.withResolvers<void>()
    pending.resolve('cancelled')
  }

  private async waitForBoundary(record: LiveSession, agent: Agent): Promise<void> {
    if (record.pendingApproval !== undefined || agent.status === 'idle') return
    await Promise.race([agent.whenIdle(), record.approvalBoundary.promise])
  }

  private async action(record: LiveSession, name: typeof INTELLECT_TOOLS[number], args: unknown): Promise<unknown> {
    const agent = await this.ensureHandle(record)
    const result: ToolExecutionResult = await agent.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId(`forge-${name}-${randomUUID()}`),
      name: `${PUBLIC_TOOL_PREFIX}${name}`,
      arguments: args,
      agent,
    })
    if (result.isError) throw new ProtocolError(`Forge Intellect ${name} failed: ${result.error.message}`, 500, 'evidence_incomplete')
    const value = result.value as { structuredContent?: unknown }
    const evidence = value.structuredContent
    if (typeof evidence !== 'object' || evidence === null
      || (evidence as { protocol_version?: unknown }).protocol_version !== FORGE_ACTION_TOOLS_PROTOCOL) {
      throw new ProtocolError(
        `Forge Intellect ${name} returned incompatible evidence`,
        500,
        'evidence_incomplete',
      )
    }
    return evidence
  }

  private async close(record: LiveSession, startSequence: number): Promise<ForgeCommandResponse> {
    this.cancelApproval(record)
    const handle = record.handle
    if (handle === undefined) throw new ProtocolError('session has no live agent handle', 500)
    const agent = handle.agent
    agent.cancel({ kind: 'disposed' })
    await agent.whenIdle()
    let evidence: unknown
    try {
      const reconciliation = await this.action(record, 'workspace_reconcile', {})
      const watermarks = await this.action(record, 'workspace_watermarks', {})
      evidence = { reconciliation, watermarks }
    } catch (error) {
      this.append(record, 'evidence.incomplete', { error: asError(error).message })
      return this.response(record, startSequence, 'terminal', 'evidence_incomplete')
    }
    try {
      await handle.dispose()
      delete record.handle
      if (record.commandTempRoot !== undefined) {
        await rm(record.commandTempRoot, { recursive: true, force: true })
        delete record.commandTempRoot
      }
      record.stored.closed = true
      this.append(record, 'session.closed', { evidence })
      return this.response(record, startSequence, 'terminal', 'succeeded', evidence)
    } catch (error) {
      this.append(record, 'cleanup.failed', { error: asError(error).message, evidence })
      return this.response(record, startSequence, 'terminal', 'cleanup_failed', evidence)
    }
  }

  private payloadText(request: ForgeCommandRequest): string {
    const text = request.payload.text ?? request.payload.message
    if (typeof text !== 'string' || text.length === 0) throw new ProtocolError('payload.text must be a non-empty string')
    return text
  }

  private status(record: LiveSession): string {
    if (record.pendingApproval !== undefined) return 'awaiting_approval'
    if (record.stored.closed) return 'closed'
    return record.handle?.agent.status ?? (record.stored.started ? 'recoverable' : 'created')
  }

  private append(record: LiveSession, type: string, data: Record<string, unknown>): void {
    const event: ForgeAdapterEvent = {
      protocol: FORGE_SESSION_PROTOCOL,
      sequence: record.stored.nextSequence++,
      type,
      event_type: type,
      session_id: record.stored.sessionId,
      causality_id: record.stored.causalityId,
      time: new Date().toISOString(),
      data,
    }
    record.events.push(event)
    if (record.events.length > MAX_RETAINED_EVENTS) record.events.splice(0, record.events.length - MAX_RETAINED_EVENTS)
  }

  private eventsFrom(record: LiveSession, sequence: number): ForgeAdapterEvent[] {
    return record.events.filter(event => event.sequence >= sequence)
  }

  private response(
    record: LiveSession,
    startSequence: number,
    status: string,
    outcome?: ForgeOutcome,
    evidence?: unknown,
  ): ForgeCommandResponse {
    return {
      status,
      events: this.eventsFrom(record, startSequence),
      ...outcome === undefined ? {} : { outcome },
      ...evidence === undefined ? {} : { evidence },
    }
  }

  private inspectBody(record: LiveSession): Record<string, unknown> {
    return {
      protocol: FORGE_SESSION_PROTOCOL,
      session_id: record.stored.sessionId,
      project_id: record.stored.projectId,
      work_id: record.stored.workId,
      intent_revision: record.stored.intentRevision,
      causality_id: record.stored.causalityId,
      status: this.status(record),
      last_sequence: record.stored.nextSequence - 1,
      pending_approval_id: record.pendingApproval?.id ?? null,
    }
  }
}

export const name = 'forge-session-adapter'

/** Mount the Forge adapter service into a Cordis composition. */
export function apply(ctx: Context, config: Config): void {
  new ForgeSessionAdapter(ctx, config)
}

export default ForgeSessionAdapter
