/** A separately composed host admits an approved handoff through its real Session Controller. */
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session'
import { HANDOFF_PATH } from '../../../packages/integration/daedal-handoff/src/protocol.ts'
import { launchWebScaffold } from './scaffold.ts'

class HandoffModel extends LlmAdapter {
  calls = 0
  override async resolveModel(provider: string, model: string) { return { provider, id: model, name: model, contextWindow: 1_000_000 } }
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls++
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'HOST_HANDOFF_RECEIVED' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'HOST_HANDOFF_RECEIVED' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('Daedal host handoff composition', () => {
  it('creates a separate host session and deduplicates an acknowledged task on repeat delivery', async () => {
    const scaffold = await launchWebScaffold({
      extraOverlayPath: fileURLToPath(new URL('./fixtures/daedal-handoff/cordis.yml', import.meta.url)),
      extraInstallAnchors: [fileURLToPath(new URL('../../cli/package.json', import.meta.url))],
      agentPresets: { roots: [{ path: fileURLToPath(new URL('../../../snapshots/session/daedal-host-handoff/presets/', import.meta.url)), trust: 'system' }], default: 'daedal' },
    })
    try {
      const model = new HandoffModel()
      scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter(['handoff-fixture'], model))
      const token = 'composition-only-handoff-token-0123456789'
      const request = { sourceSessionId: 'isolated-source', callId: 'approved-handoff', preset: 'daedal',
        destination: { name: 'Host fixture', cwd: scaffold.workspaceCwd },
        title: 'Verify the committed update', task: 'Inspect the committed update and report readiness. Do not change files.',
      }
      const send = () => fetch(scaffold.baseUrl + HANDOFF_PATH, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(request),
      })
      const settled = scaffold.whenTurnSettled()
      const response = await send()
      expect(response.status).toBe(200)
      const receipt = await response.json() as { sessionId: string; accepted: true }
      expect(await settled).toBe(receipt.sessionId)
      const agent = scaffold.ctx.agents.get(SessionId(receipt.sessionId))!
      expect(agent.session.header.agentPreset).toBe('daedal')
      expect(agent.session.header.cwd).toBe(scaffold.workspaceCwd)
      expect(agent.session.snapshotEvents().some(event => event.type === 'user/message'
        && JSON.stringify(event.data).includes(request.task))).toBe(true)
      expect(agent.session.snapshotEvents().some(event => event.type === 'user/message'
        && JSON.stringify(event.data).includes('Execution environment: host.'))).toBe(true)
      expect((await send()).status).toBe(200)
      await agent.whenIdle()
      expect(model.calls).toBe(1)
      expect(scaffold.ctx.agents.roots()).toHaveLength(1)
      expect(scaffold.ctx.tools.schemas().map(schema => schema.name)).not.toContain('handoff_to_host')
      expect(scaffold.ctx.tools.schemas(agent).map(schema => schema.name)).toContain('handoff_to_host')
    } finally { await scaffold.close() }
  })
})
