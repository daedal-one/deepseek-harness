import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ModelRouting from '../src/index.ts'
import { ModelCatalog, taskClassId } from '../src/index.ts'
import type { ModelCatalogSnapshot, RoutingCandidate, TaskClassSpec } from '../src/index.ts'

/** A catalog that serves fixed snapshots and records every read. */
class FakeCatalog extends ModelCatalog {
  readonly calls: string[] = []
  snapshots: Record<string, ModelCatalogSnapshot> = {}

  override async snapshot(provider: string): Promise<ModelCatalogSnapshot> {
    this.calls.push(provider)
    const snapshot = this.snapshots[provider]
    if (snapshot === undefined) throw new Error(`no snapshot for provider "${provider}"`)
    return snapshot
  }
}

const CANDIDATES: readonly RoutingCandidate[] = [
  { model: 'vendor/cheap', supportsReasoning: true, inputUsdPerToken: 0.0000001, outputUsdPerToken: 0.0000002 },
  { model: 'vendor/pricey', supportsReasoning: true, inputUsdPerToken: 0.00001, outputUsdPerToken: 0.00002 },
]

const CLASSES: Readonly<Record<string, TaskClassSpec>> = {
  standard: {
    requirements: {},
    tiers: [{ name: 'trusted', modelPatterns: ['vendor/*'] }],
    costBasis: { inputTokens: 1000, outputTokens: 100 },
  },
  'hard-reasoning': {
    requirements: { requiresReasoning: true },
    tiers: [{ name: 'trusted', modelPatterns: ['vendor/*'] }],
    costBasis: { inputTokens: 1000, outputTokens: 100 },
  },
}

async function mount(
  snapshots: Record<string, ModelCatalogSnapshot> = { openrouter: { revision: 'r1', candidates: CANDIDATES } },
): Promise<{ ctx: Context; catalog: FakeCatalog; routing: ModelRouting }> {
  const ctx = new Context()
  await ctx.plugin(FakeCatalog)
  const catalog = ctx.modelCatalog as FakeCatalog
  catalog.snapshots = snapshots
  await ctx.plugin(ModelRouting, { classes: CLASSES })
  return { ctx, catalog, routing: ctx.modelRouting }
}

describe('ModelRouting', () => {
  it('lists declared classes in stable order', async () => {
    const { routing } = await mount()

    expect(routing.classIds()).toEqual([taskClassId('hard-reasoning'), taskClassId('standard')])
  })

  it('reads one declared class', async () => {
    const { routing } = await mount()

    expect(routing.specOf(taskClassId('standard')).tiers[0]?.name).toBe('trusted')
  })

  it('refuses an undeclared class by name', async () => {
    const { routing } = await mount()

    expect(() => routing.specOf(taskClassId('missing'))).toThrow('model routing: unknown task class "missing"')
  })

  it('resolves a class within the provider it is asked about', async () => {
    const { routing, catalog } = await mount()

    const result = await routing.resolve(taskClassId('standard'), 'openrouter')

    expect(result.kind).toBe('selected')
    if (result.kind !== 'selected') return
    expect(result.winner.model).toBe('vendor/cheap')
    expect(catalog.calls).toEqual(['openrouter'])
  })

  it('refuses an undeclared class before reading the catalog', async () => {
    const { routing, catalog } = await mount()

    await expect(routing.resolve(taskClassId('missing'), 'openrouter')).rejects.toThrow(
      'model routing: unknown task class "missing"',
    )
    expect(catalog.calls).toEqual([])
  })

  it('reuses a memoized resolution while the catalog revision holds', async () => {
    const { routing, catalog } = await mount()

    const first = await routing.resolve(taskClassId('standard'), 'openrouter')
    const second = await routing.resolve(taskClassId('standard'), 'openrouter')

    expect(second).toBe(first)
    // The revision is read every time; only the ranking is memoized.
    expect(catalog.calls).toEqual(['openrouter', 'openrouter'])
  })

  it('re-resolves when the catalog revision moves', async () => {
    const { routing, catalog } = await mount({ openrouter: { revision: 'r1', candidates: CANDIDATES } })

    const first = await routing.resolve(taskClassId('standard'), 'openrouter')
    catalog.snapshots = {
      openrouter: {
        revision: 'r2',
        candidates: [...CANDIDATES, {
          model: 'vendor/newcomer',
          supportsReasoning: true,
          inputUsdPerToken: 0,
          outputUsdPerToken: 0,
        }],
      },
    }
    const second = await routing.resolve(taskClassId('standard'), 'openrouter')

    expect(second).not.toBe(first)
    expect(second.kind).toBe('selected')
    if (second.kind !== 'selected') return
    expect(second.winner.model).toBe('vendor/newcomer')
  })

  it('memoizes each provider route independently', async () => {
    const { routing } = await mount({
      openrouter: { revision: 'r1', candidates: CANDIDATES },
      other: { revision: 'r1', candidates: [CANDIDATES[1]!] },
    })

    const first = await routing.resolve(taskClassId('standard'), 'openrouter')
    const second = await routing.resolve(taskClassId('standard'), 'other')

    expect(second).not.toBe(first)
    expect(second.kind).toBe('selected')
    if (second.kind !== 'selected') return
    expect(second.winner.model).toBe('vendor/pricey')
  })

  it('drops memoized resolutions on demand', async () => {
    const { routing } = await mount()

    const first = await routing.resolve(taskClassId('standard'), 'openrouter')
    routing.invalidate()
    const second = await routing.resolve(taskClassId('standard'), 'openrouter')

    expect(second).not.toBe(first)
    expect(second).toEqual(first)
  })

  it('propagates an unsatisfied class without inventing a route', async () => {
    const { routing } = await mount({
      openrouter: { revision: 'r1', candidates: [{ model: 'newcomer/model', supportsReasoning: false, inputUsdPerToken: 0, outputUsdPerToken: 0 }] },
    })

    const result = await routing.resolve(taskClassId('standard'), 'openrouter')

    expect(result.kind).toBe('unsatisfied')
    if (result.kind !== 'unsatisfied') return
    expect(result.observed).toEqual(['newcomer/model'])
  })

  it('validates a raw class id', async () => {
    expect(ModelRouting.idOf('hard-reasoning')).toBe(taskClassId('hard-reasoning'))
    expect(() => ModelRouting.idOf('Not Valid')).toThrow(TypeError)
  })

  it('declares no classes when the deployment configures none', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeCatalog)
    await ctx.plugin(ModelRouting)

    expect(ctx.modelRouting.classIds()).toEqual([])
  })
})
