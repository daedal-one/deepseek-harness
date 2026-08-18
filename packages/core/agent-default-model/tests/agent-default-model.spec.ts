/** Per-Agent model settings layered over a real settings provider and LLM catalog. */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentModelConfig, {
  AGENT_MODELS_SETTINGS_NAMESPACE,
  agentModelTargetId,
} from '../src/index.ts'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import LlmRuntime, {
  LlmAdapter,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

const MODELS: readonly LlmModelInfo[] = [
  { provider: 'openrouter', id: 'fast', name: 'Fast' },
  { provider: 'openrouter', id: 'think', name: 'Think' },
]

/** Catalog adapter that validates exact model ids and one reasoning level. */
class CatalogAdapter extends LlmAdapter {
  override listModels(): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(MODELS)
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    if (!MODELS.some(entry => entry.id === model)) throw new Error(`unknown model ${model}`)
    return Promise.resolve({
      provider,
      id: model,
      name: model === 'fast' ? 'Fast' : 'Think',
      ...model === 'think'
        ? {
          reasoning: {
            efforts: [{ id: ReasoningEffortId('high'), name: 'High' }],
            defaultEffort: ReasoningEffortId('high'),
          },
        }
        : {},
    })
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('not exercised')
  }
}

async function boot(): Promise<{
  ctx: Context
  settingsFiber: Context['fiber']
  models: AgentModelConfig
}> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['openrouter'], new CatalogAdapter())
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  await ctx.plugin(AgentModelConfig, {
    provider: 'openrouter',
    model: 'fast',
  })
  return { ctx, settingsFiber, models: ctx.agentModels }
}

describe('AgentModelConfig', () => {
  it('persists validated main-Agent model and reasoning selections', async () => {
    const bench = await boot()
    await bench.models.saveSelection({
      provider: 'openrouter', model: 'think', reasoningEffort: ReasoningEffortId('high'),
    })
    expect(bench.models.currentSelection()).toEqual({
      provider: 'openrouter', model: 'think', reasoningEffort: 'high',
    })
    expect(bench.settingsFiber.ctx.settings.describe({ redactSecrets: true })
      .find(entry => entry.ns === AGENT_MODELS_SETTINGS_NAMESPACE)?.user).toEqual({
      agents: { main: { model: 'think', reasoningEffort: 'high' } },
    })
    await bench.ctx.fiber.dispose()
  })

  it('registers named roles, coalesces identical owners, and rejects conflicts', async () => {
    const bench = await boot()
    const id = agentModelTargetId('reviewer')
    const observed: boolean[] = []
    bench.ctx.on('agent-models/directory-updated', () => {
      try {
        bench.models.currentSelection(id)
        observed.push(true)
      } catch {
        observed.push(false)
      }
    })
    const target = {
      id,
      label: 'Reviewer',
      defaultSelection: { provider: 'openrouter', model: 'think' },
    }
    const first = bench.models.registerTarget(target)
    const second = bench.models.registerTarget(target)
    expect((await bench.models.list()).targets.map(entry => entry.id)).toEqual(['main', 'reviewer'])
    expect(observed).toEqual([true])
    expect(() => bench.models.registerTarget({ ...target, label: 'Other' })).toThrow(/conflicting definitions/)
    expect(observed).toEqual([true])
    first()
    expect((await bench.models.list()).targets.map(entry => entry.id)).toEqual(['main', 'reviewer'])
    expect(observed).toEqual([true])
    second()
    expect((await bench.models.list()).targets.map(entry => entry.id)).toEqual(['main'])
    expect(observed).toEqual([true, false])
    await bench.ctx.fiber.dispose()
  })

  it('contains directory observer failures after each committed mutation', async () => {
    const bench = await boot()
    const warn = vi.spyOn(bench.ctx.logger, 'warn').mockImplementation(() => undefined)
    const later = vi.fn()
    bench.ctx.on('agent-models/directory-updated', () => { throw new Error('broken observer') })
    bench.ctx.on('agent-models/directory-updated', later)

    const dispose = bench.models.registerTarget({ id: agentModelTargetId('guru'), label: 'Guru' })
    expect((await bench.models.list()).targets.map(entry => entry.label)).toEqual(['Main agent', 'Guru'])
    expect(later).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('agent-models/directory-updated listener threw: Error: broken observer')

    dispose()
    expect(later).toHaveBeenCalledTimes(2)
    await bench.ctx.fiber.dispose()
  })

  it('gives an inherited named role its own stable deployment default', async () => {
    const bench = await boot()
    const id = agentModelTargetId('subagent')
    bench.models.registerTarget({ id, label: 'Subagent' })
    await bench.models.saveSelection({ provider: 'openrouter', model: 'think' })

    expect(bench.models.currentSelection()).toEqual({ provider: 'openrouter', model: 'think' })
    expect(bench.models.currentSelection(id)).toEqual({ provider: 'openrouter', model: 'fast' })
    expect((await bench.models.list()).targets.find(target => target.id === id)?.defaultSelection)
      .toEqual({ model: 'fast' })
    await bench.ctx.fiber.dispose()
  })

  it('applies a saved named selection to future child options only', async () => {
    const bench = await boot()
    const id = agentModelTargetId('coder')
    bench.models.registerTarget({
      id,
      label: 'Coder',
      defaultSelection: { provider: 'openrouter', model: 'fast' },
    })
    const opened = await bench.models.list()
    await bench.models.save(id, 'think', 'high', opened.revision)
    expect(bench.models.optionsFor(id, { provider: 'old', model: 'old', maxTokens: 512 })).toEqual({
      provider: 'openrouter', model: 'think', reasoningEffort: 'high', maxTokens: 512,
    })
    await bench.ctx.fiber.dispose()
  })

  it('rejects another provider, unknown models, and unsupported effort', async () => {
    const bench = await boot()
    await expect(bench.models.saveSelection({ provider: 'other', model: 'fast' }))
      .rejects.toThrow(/cannot replace deployment provider/)
    await expect(bench.models.save(agentModelTargetId('main'), 'missing', undefined, 0))
      .rejects.toThrow(/unknown model/)
    await expect(bench.models.save(agentModelTargetId('main'), 'fast', 'high', 0))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_REASONING_EFFORT' })
    await bench.ctx.fiber.dispose()
  })

  it('falls back to deployment defaults when the settings provider detaches', async () => {
    const bench = await boot()
    await bench.models.saveSelection({ provider: 'openrouter', model: 'think' })
    await bench.settingsFiber.dispose()
    expect(bench.models.currentSelection()).toEqual({ provider: 'openrouter', model: 'fast' })
    await bench.ctx.fiber.dispose()
  })
})
