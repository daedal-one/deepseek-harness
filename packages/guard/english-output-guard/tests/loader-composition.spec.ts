import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import * as guard from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

class CompositionAdapter extends LlmAdapter {
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const text = options.provider === 'main'
      ? '中文回答'
      : '{"translations":[{"index":0,"type":"text","text":"English answer"}]}'
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

function nextIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent || status !== 'idle') return
      dispose()
      resolve()
    })
  })
}

async function load(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-english-output-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-agent-loop'",
    '  config: { agents: [] }',
    "- name: '@deepseek-ai/dsh-english-output-guard'",
    '  config:',
    '    targets: [{ provider: main, model: selected }]',
    '    translator: { provider: translator, model: english }',
    '    hanMinChars: 2',
    '    hanRatio: 0.2',
    '    maxTranslationInputChars: 10000',
    '    maxOutputTokens: 500',
    '    timeoutMs: 1000',
    '    failureMode: block',
    '    translationNotice: none',
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
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-english-output-guard', guard],
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

describe('real Loader English-output composition', () => {
  it('translates through a scripted adapter and real AgentLoop', async () => {
    const loaded = await load()
    expect([...loaded.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
    loaded.llm.registerAdapter(['main', 'translator'], new CompositionAdapter())
    const agent = loaded.agentLoop.create(SessionId('loader-composition'), { provider: 'main', model: 'selected' })
    const idle = nextIdle(loaded, agent)
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] }))
    await idle
    const message = agent.session.events.findLast(event => event.type === 'assistant/message')
    expect(message?.data.message.content).toEqual([{ type: 'text', text: 'English answer' }])
    expect(agent.session.events.map(event => event.type)).toContain('english-output/translation-request')
  })
})
