/** A separately composed host admits an approved handoff through its real Session Controller. */
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
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
      agentPresets: { roots: [
        { path: fileURLToPath(new URL('./fixtures/daedal-handoff/presets/', import.meta.url)), trust: 'system' },
        { path: fileURLToPath(new URL('../../../snapshots/session/daedal-host-handoff/presets/', import.meta.url)), trust: 'system' },
      ], default: 'daedal' },
    })
    try {
      const model = new HandoffModel()
      scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter(['handoff-fixture'], model))
      const token = 'composition-only-handoff-token-0123456789'
      const sourceId = SessionId('coding-source')
      await scaffold.ctx.sessionController.create({ sessionId: sourceId, agentPreset: 'daedal', cwd: scaffold.workspaceCwd })
      const source = scaffold.ctx.agents.get(sourceId)!
      const sourceEvents = source.session.snapshotEvents()
      expect(scaffold.ctx.permissionPresets.current(source.session)).toBe('workspace-write')
      const discovery = await fetch(scaffold.baseUrl + HANDOFF_PATH, { headers: { authorization: `Bearer ${token}` } })
      expect(discovery.status).toBe(200)
      const catalog = await discovery.json() as { name: string; targets: unknown[] }
      const request = { sourceSessionId: sourceId, callId: 'approved-handoff',
        destination: { name: catalog.name, target: catalog.targets[0] },
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
      expect(agent.session.header.agentPreset).toBe('maintenance')
      expect(scaffold.ctx.permissionPresets.current(agent.session)).toBe('read-only')
      expect(agent.session.snapshotEvents()).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'sandbox/mode', data: { mode: 'read-only' } }),
        expect.objectContaining({ type: 'approval/policy', data: { policy: 'ask' } }),
      ]))
      expect(agent.session.header.cwd).toBe(scaffold.workspaceCwd)
      expect(agent.session.snapshotEvents().some(event => event.type === 'user/message'
        && JSON.stringify(event.data).includes(request.task))).toBe(true)
      expect(agent.session.snapshotEvents().some(event => event.type === 'user/message'
        && JSON.stringify(event.data).includes('Execution environment: host.'))).toBe(true)
      expect((await send()).status).toBe(200)
      await agent.whenIdle()
      expect(model.calls).toBe(1)
      expect(scaffold.ctx.agents.roots()).toHaveLength(2)
      expect(source.session.snapshotEvents()).toEqual(sourceEvents)
      expect(source.session.header.agentPreset).toBe('daedal')
      expect(scaffold.ctx.permissionPresets.current(source.session)).toBe('workspace-write')
      expect(scaffold.ctx.tools.schemas().map(schema => schema.name)).not.toContain('handoff_to_host')
      expect(scaffold.ctx.tools.schemas(agent).map(schema => schema.name)).toContain('handoff_to_host')
      expect(scaffold.ctx.tools.schemas(agent).map(schema => schema.name)).toContain('inspect_host_fixture')
      expect(scaffold.ctx.tools.schemas(source).map(schema => schema.name)).not.toContain('inspect_host_fixture')
      const denied = await scaffold.ctx.tools.execute({ name: 'write', agent,
        arguments: { file_path: 'denied-host-write.txt', content: 'denied' },
        callId: ToolCallId('policy-probe'), signal: new AbortController().signal,
      })
      expect(denied.isError).toBe(true)
      expect(JSON.stringify(denied.content)).toContain('read-only')
    } finally { await scaffold.close() }
  })
})
