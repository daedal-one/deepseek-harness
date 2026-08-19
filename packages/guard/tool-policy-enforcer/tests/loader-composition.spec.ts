import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime, { CallId, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolPolicyService from '@deepseek-ai/dsh-tool-policy'
import * as shellPolicy from '@deepseek-ai/dsh-tool-policy-shell'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import * as enforcer from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

class AllowAdapter extends LlmAdapter {
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const text = options.provider === 'intent'
      ? '{"userSummary":"inspect","agentSummary":"inspect","allowedEffects":["host-read"],"forbiddenEffects":[],"alignment":"aligned"}'
      : '{"effects":["host-read"],"risk":8,"reason":"reads host information"}'
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function load(configureEnforcer = true): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-tool-policy-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-tool-policy'",
    "- name: '@deepseek-ai/dsh-tool-policy-shell'",
    '  config:',
    '    id: shell',
    '    mappings: [{ tool: bash, commandArgument: command, intentArgument: description }]',
    '    intent: { provider: intent, model: intent-reviewer }',
    '    primary: { provider: primary, model: effect-classifier }',
    '    secondary: { provider: secondary, model: effect-reviewer }',
    '    timeoutMs: 1000',
    '    maxTokens: 80',
    '    maxCommandChars: 1000',
    '    maxUserMessageChars: 100',
    '    maxIntentChars: 100',
    '    maxOutputChars: 1000',
    '    maxSummaryChars: 80',
    '    maxReasonChars: 80',
    '    maxEffects: 8',
    '    rules: []',
    "- name: '@deepseek-ai/dsh-tool-policy-enforcer'",
    ...(configureEnforcer ? [
      '  config:',
      '    enforceWhen:',
      '      sandboxModes: [danger-full-access]',
      '      approvalPolicies: [ask]',
    ] : []),
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-tool-policy', ToolPolicyService],
    ['@deepseek-ai/dsh-tool-policy-shell', shellPolicy],
    ['@deepseek-ai/dsh-tool-policy-enforcer', enforcer],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()
  return context
}

describe('real Loader policy composition', () => {
  it('loads an omitted enforcer config for unconditional enforcement', async () => {
    const loaded = await load(false)
    expect([...loaded.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
  })

  it('classifies and authorizes through a scripted LLM and real ToolRuntime', { timeout: 60_000 }, async () => {
    const loaded = await load()
    expect([...loaded.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
    loaded.llm.registerAdapter(['intent', 'primary', 'secondary'], new AllowAdapter())
    let ran = false
    loaded.tools.register(defineTool({
      name: 'bash', description: 'test shell', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => { ran = true; return 'ran' },
    }))
    const events: Array<Record<string, unknown>> = [
      { seq: 1, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'inspect the host' }] } },
      { seq: 3, type: 'tool/call', data: { callId: CallId('c'), name: 'bash', arguments: '{}' } },
      { seq: 4, type: 'sandbox/mode', data: { mode: 'danger-full-access' } },
      { seq: 5, type: 'approval/policy', data: { policy: 'ask' } },
    ]
    const agent = {
      options: { provider: 'acting', model: 'acting-model' },
      session: {
        id: 'loader', header: { id: 'loader', cwd: '/work' }, events,
        append(type: string, data: unknown) { const event = { seq: events.length + 1, type, data }; events.push(event); return event },
      },
    } as unknown as Agent
    await expect(loaded.tools.execute({
      callId: CallId('c'), name: 'bash', arguments: { command: 'uname -a', description: 'inspect the host' }, agent,
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ isError: false })
    expect(ran).toBe(true)
    expect(events.map(event => event.type)).toContain('tool-policy/classifier-request')
    expect(events.filter(event => event.type === 'tool-policy/decision')).toHaveLength(3)
  })
})
