import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { mountPreset, executionContextForAgent } from '@deepseek-ai/dsh-agent-presets'
import LlmRuntime, {
  LlmAdapter, ReasoningEffortId, ToolCallId, createUserMessage,
  type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { bindScopeParent, createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import ToolPolicyService from '@deepseek-ai/dsh-tool-policy'
import { describe, expect, it } from 'vitest'
import { apply, type Config } from '../src/index.ts'

const HOST = Symbol.for('@deepseek-ai/dsh/host-execution-world')
const UNVERIFIED = {}

class EvidenceAdapter extends LlmAdapter {
  readonly seen: string[] = []

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, reasoning: { efforts: [{ id: ReasoningEffortId('minimal'), name: 'Minimal' }] } })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.seen.push(options.provider)
    yield { type: 'text-delta', index: 0, text: options.provider === 'intent'
      ? 'host-read\n-\ninspect system information' : 'aligned;host-read' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const config: Config = {
  id: 'shell',
  mappings: [{ tool: 'bash', commandArgument: 'command' }],
  intent: { provider: 'intent', model: 'intent', reasoningEffort: 'minimal' },
  primary: { provider: 'primary', model: 'primary' },
  secondary: { provider: 'secondary', model: 'secondary' },
  decisionTimeoutMs: 200,
  intentContextTimeoutMs: 200,
  maxTokens: 80,
  maxCommandChars: 1_000,
  maxUserMessageChars: 100,
  maxIntentChars: 100,
  maxOutputChars: 1_000,
  maxSummaryChars: 80,
  maxEffects: 8,
  rules: [{ pattern: 'git status', decision: 'deny', reason: 'host rule' }],
  containedExecutionWorld: true,
}

async function harness(fsWorld: symbol | object, subprocessWorld: symbol | object) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-shell-world-'))
  const ctx = new Context()
  try {
    const composition = join(root, 'cordis.yml')
    await writeFile(composition, [
      '- id: executor',
      '  name: cordis:executor',
      '  isolate: { shell: true, fs: true, subprocess: true }',
      '',
    ].join('\n'))
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.builtins.executor = {
      name: 'executor',
      apply(scoped: Context) {
        for (const [name, executionWorld] of [
          ['shell', HOST], ['fs', fsWorld], ['subprocess', subprocessWorld],
        ] as const) {
          const dispose = scoped.reflect.provide(name, { executionWorld })
          scoped.effect(() => dispose)
        }
      },
    }
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(ToolPolicyService, {})
    const container = {}
    ctx.provide('localContainerExecutionWorld', container as never)
    ctx.provide('fs', { executionWorld: container } as never)
    ctx.provide('subprocess', { executionWorld: container } as never)
    apply(ctx, config)
    const standingKey = {}
    const standing = createScope(ctx, standingKey)
    await mountPreset(standing.ctx, { id: 'isolated', trust: 'system', path: composition })
    const agentKey = {}
    const scope = createScope(ctx, agentKey)
    bindScopeParent(agentKey, standingKey)
    return { ctx, root, standing, scope }
  } catch (error) {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

describe('requesting agent execution world', () => {
  it.each([
    ['host', HOST, HOST],
    ['mixed', HOST, {}],
    ['unverified', UNVERIFIED, UNVERIFIED],
  ] as const)('does not exempt %s preset providers under a container root', async (_label, files, processes) => {
    const { ctx, root, standing, scope } = await harness(files, processes)
    try {
      const session = ctx.sessions.create(SessionId('isolated-world'), { meta: { cwd: root } })
      session.append('turn/start', { turn: 1 })
      session.append('user/message', createUserMessage({
        source: { kind: 'user' }, content: [{ type: 'text', text: 'Inspect this system.' }],
      }), { surfaceOp: 'append' })
      const adapter = new EvidenceAdapter()
      ctx.llm.registerAdapter(['intent', 'primary', 'secondary'], adapter)
      const agent = { ctx: scope.ctx, session, options: {} }
      const execution = executionContextForAgent(ctx, agent)
      expect(execution).not.toBe(ctx)
      expect(execution.get('shell')?.executionWorld).toBe(HOST)
      const evaluate = (requestingAgent: typeof agent, command: string) => ctx.toolPolicy.evaluate({
        callId: ToolCallId('world-call'), toolName: 'bash', arguments: { command },
        agent: requestingAgent as never, signal: new AbortController().signal,
      })
      await expect(evaluate({ ...agent, ctx }, 'git status')).resolves.toBeUndefined()
      if (files === HOST && processes === HOST) {
        await expect(evaluate(agent, 'git status')).resolves.toMatchObject({ decision: 'deny', reason: 'host rule' })
        await expect(evaluate(agent, 'system_profiler SPSoftwareDataType')).resolves.toMatchObject({ decision: 'allow' })
        expect(adapter.seen).toEqual(['intent', 'primary'])
        expect(session.snapshotEvents().filter(event => event.type === 'tool-policy/classifier-request')).toHaveLength(2)
      } else {
        await expect(evaluate(agent, 'git status')).rejects.toThrow(/verified matching/)
        expect(adapter.seen).toEqual([])
      }
    } finally {
      await scope.dispose()
      await standing.dispose()
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
