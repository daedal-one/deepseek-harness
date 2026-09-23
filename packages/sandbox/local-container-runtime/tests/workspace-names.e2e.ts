import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import ProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import LlmRuntime, { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { expect, it, vi } from 'vitest'
import { generateWorkspaceTopics } from '../src/workspace-names.ts'

// Explicit opt-in keeps this paid quality check separate from container lifecycle tests.
it.skipIf(process.env.DSH_WORKSPACE_NAMES_E2E !== '1' || !process.env.OPENROUTER_API_KEY)(
  'names saved branches through Flash using recorded conversation context', { retry: 0 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-live-workspace-names-'))
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(ProjectionRegistry)
      await ctx.plugin(Persistence, { root: join(root, 'sessions'), compression: 'none' })
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(LlmPiAi, { providers: { openrouter: {
        apiKeyEnv: 'OPENROUTER_API_KEY', reasoning: 'off', retryPolicy: { mode: 'normal', maxRetries: 0 },
        api: 'openai-completions',
        models: [{ id: 'deepseek/deepseek-v4.1-flash', contextWindow: 1_000_000, maxTokens: 256,
          reasoningEfforts: { off: 'none', high: 'high' } }],
        compat: { openRouterRouting: { allow_fallbacks: false, max_price: { prompt: 1, completion: 2, request: 0.01 } } },
      } } })
      const stream = ctx.llm.stream.bind(ctx.llm)
      const response = new BlockAssembler()
      const observe = vi.spyOn(ctx.llm, 'stream').mockImplementation(async function* (request) {
        for await (const chunk of stream(request)) { response.push(chunk); yield chunk }
      })
      const session = ctx.sessions.create(undefined, { meta: { cwd: root } })
      session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [
        { type: 'text', text: 'Fix the workspace recovery race so saved branches survive interrupted shutdown.' },
      ] }), { surfaceOp: 'append' })
      const config = {
        messageProvider: 'openrouter', messageModel: 'deepseek/deepseek-v4.1-flash',
        messageInputBytes: 4096, messageOutputTokens: 256, messageTimeoutMs: 30000, maxOutputBytes: 65536,
      }
      const names = await generateWorkspaceTopics(ctx, session, 1, ['HEAD', 'refs/heads/fix'],
        'workspaces.ts | 12 ++++++++----\n recovery.spec.ts | 28 ++++++++++++++++++++++++++++', config)
      observe.mockRestore()
      console.info('Live naming response:', { finish: response.finish, usage: response.usage, blocks: response.blocks() })
      expect(names).toBeDefined()
      expect(Object.keys(names ?? {}).sort()).toEqual(['HEAD', 'refs/heads/fix'])
      for (const ref of ['HEAD', 'refs/heads/fix']) expect(names?.[ref]).toMatch(/recover|shutdown|workspace/u)
      expect(session.snapshotEvents().filter(event => event.type === 'workspace/branch-name-request')).toHaveLength(1)
      console.info('Live workspace topics:', names)
    } finally {
      try { await ctx.fiber.dispose() } finally { await rm(root, { recursive: true, force: true }) }
    }
  },
)
