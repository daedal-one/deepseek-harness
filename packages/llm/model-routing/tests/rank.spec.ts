import { describe, expect, it } from 'vitest'
import { estimateCallUsd, rankTaskClass } from '../src/rank.ts'
import { taskClassId } from '../src/spec.ts'
import type { RoutingCandidate, TaskClassSpec } from '../src/types.ts'

/** One representative call: 1000 prompt tokens and 100 completion tokens. */
const BASIS = { inputTokens: 1000, outputTokens: 100 }

/** Cost of {@link BASIS} on a candidate priced at these two rates. */
function costOf(inputUsdPerToken: number | null, outputUsdPerToken: number | null): number | null {
  return inputUsdPerToken === null || outputUsdPerToken === null
    ? null
    : BASIS.inputTokens * inputUsdPerToken + BASIS.outputTokens * outputUsdPerToken
}

function candidate(overrides: Partial<RoutingCandidate> & { readonly model: string }): RoutingCandidate {
  return {
    supportsReasoning: false,
    inputUsdPerToken: 0.000001,
    outputUsdPerToken: 0.000002,
    ...overrides,
  }
}

function spec(overrides: Partial<TaskClassSpec> = {}): TaskClassSpec {
  return {
    requirements: {},
    tiers: [{ name: 'preferred', modelPatterns: ['vendor/*'] }],
    costBasis: BASIS,
    ...overrides,
  }
}

const CLASS = taskClassId('standard')

describe('estimateCallUsd', () => {
  it('prices one representative call from both rates', () => {
    expect(estimateCallUsd(candidate({ model: 'vendor/a' }), BASIS)).toBeCloseTo(costOf(0.000001, 0.000002)!, 12)
  })

  it('is unpriceable when either rate is absent', () => {
    expect(estimateCallUsd(candidate({ model: 'vendor/a', inputUsdPerToken: null }), BASIS)).toBeNull()
    expect(estimateCallUsd(candidate({ model: 'vendor/a', outputUsdPerToken: null }), BASIS)).toBeNull()
  })

  it('is unpriceable when a rate is not a usable number', () => {
    expect(estimateCallUsd(candidate({ model: 'vendor/a', inputUsdPerToken: Number.NaN }), BASIS)).toBeNull()
    expect(estimateCallUsd(candidate({ model: 'vendor/a', inputUsdPerToken: Number.POSITIVE_INFINITY }), BASIS)).toBeNull()
    expect(estimateCallUsd(candidate({ model: 'vendor/a', outputUsdPerToken: -1 }), BASIS)).toBeNull()
  })

  it('is unpriceable when the estimated cost overflows', () => {
    const overflow = { inputTokens: Number.MAX_VALUE, outputTokens: 0 }

    expect(estimateCallUsd(candidate({ model: 'vendor/a', inputUsdPerToken: 2, outputUsdPerToken: 0 }), overflow)).toBeNull()
  })
})

describe('rankTaskClass', () => {
  it('selects the cheapest eligible model in the preferred tier', () => {
    const result = rankTaskClass(CLASS, spec(), [
      candidate({ model: 'vendor/expensive', inputUsdPerToken: 0.00001, outputUsdPerToken: 0.00002 }),
      candidate({ model: 'vendor/cheap', inputUsdPerToken: 0.0000001, outputUsdPerToken: 0.0000002 }),
    ])

    expect(result.kind).toBe('selected')
    if (result.kind !== 'selected') return
    expect(result.winner.model).toBe('vendor/cheap')
    expect(result.tier).toBe('preferred')
    expect(result.estimatedUsd).toBeCloseTo(costOf(0.0000001, 0.0000002)!, 12)
    expect(result.eligible).toEqual(['vendor/expensive', 'vendor/cheap'])
    expect(result.observed).toEqual([])
    expect(result.rejected).toEqual([])
  })

  it('prefers an earlier tier over a cheaper model in a later tier', () => {
    const result = rankTaskClass(CLASS, spec({
      tiers: [
        { name: 'first', modelPatterns: ['vendor/premium*'] },
        { name: 'fallback', modelPatterns: ['vendor/*'] },
      ],
    }), [
      candidate({ model: 'vendor/premium-1', inputUsdPerToken: 0.001, outputUsdPerToken: 0.002 }),
      candidate({ model: 'vendor/budget', inputUsdPerToken: 0.0000001, outputUsdPerToken: 0.0000002 }),
    ])

    expect(result.kind).toBe('selected')
    if (result.kind !== 'selected') return
    expect(result.winner.model).toBe('vendor/premium-1')
    expect(result.tier).toBe('first')
  })

  it('reports the nearest beaten candidate as the runner-up', () => {
    const result = rankTaskClass(CLASS, spec(), [
      candidate({ model: 'vendor/a', inputUsdPerToken: 0.0000001, outputUsdPerToken: 0.0000002 }),
      candidate({ model: 'vendor/b', inputUsdPerToken: 0.0000002, outputUsdPerToken: 0.0000004 }),
      candidate({ model: 'vendor/c', inputUsdPerToken: 0.0000009, outputUsdPerToken: 0.0000009 }),
    ])

    expect(result.kind).toBe('selected')
    if (result.kind !== 'selected') return
    expect(result.winner.model).toBe('vendor/a')
    expect(result.runnerUp).toEqual({ model: 'vendor/b', estimatedUsd: costOf(0.0000002, 0.0000004) })
  })

  it('is deterministic when two candidates cost the same', () => {
    const tied = [
      candidate({ model: 'vendor/zeta' }),
      candidate({ model: 'vendor/alpha' }),
    ]
    const first = rankTaskClass(CLASS, spec(), tied)
    const reversed = rankTaskClass(CLASS, spec(), [...tied].reverse())

    expect(first.kind).toBe('selected')
    expect(reversed.kind).toBe('selected')
    if (first.kind !== 'selected' || reversed.kind !== 'selected') return
    expect(first.winner.model).toBe('vendor/alpha')
    expect(reversed.winner.model).toBe('vendor/alpha')
    expect(first.runnerUp?.model).toBe('vendor/zeta')
  })

  it('matches a family pattern without a configuration edit', () => {
    const result = rankTaskClass(CLASS, spec({
      tiers: [{ name: 'trusted', modelPatterns: ['vendor/*'] }],
    }), [candidate({ model: 'vendor/released-today' })])

    expect(result.kind).toBe('selected')
  })

  it('treats a pattern literally apart from the wildcard', () => {
    const result = rankTaskClass(CLASS, spec({
      tiers: [{ name: 'exact', modelPatterns: ['vendor/a.b:nitro'] }],
    }), [
      candidate({ model: 'vendor/axb:nitro' }),
      candidate({ model: 'vendor/a.b:nitro' }),
    ])

    expect(result.kind).toBe('selected')
    if (result.kind !== 'selected') return
    expect(result.winner.model).toBe('vendor/a.b:nitro')
  })

  it('rejects a candidate below the required context capacity', () => {
    const result = rankTaskClass(CLASS, spec({ requirements: { minContextTokens: 200_000 } }), [
      candidate({ model: 'vendor/small', contextTokens: 128_000 }),
    ])

    expect(result.kind).toBe('unsatisfied')
    if (result.kind !== 'unsatisfied') return
    expect(result.eligible).toEqual([])
    expect(result.rejected).toEqual([{
      model: 'vendor/small',
      reason: 'context capacity 128000 is below the required 200000',
    }])
  })

  it('rejects a candidate whose context capacity is unknown', () => {
    const result = rankTaskClass(CLASS, spec({ requirements: { minContextTokens: 200_000 } }), [
      candidate({ model: 'vendor/unknown' }),
    ])

    expect(result.rejected[0]?.reason).toBe('declares no context capacity, so it cannot satisfy a 200000-token minimum')
  })

  it('accepts a candidate exactly at the required context capacity', () => {
    const result = rankTaskClass(CLASS, spec({ requirements: { minContextTokens: 200_000 } }), [
      candidate({ model: 'vendor/exact', contextTokens: 200_000 }),
    ])

    expect(result.kind).toBe('selected')
  })

  it('requires selectable reasoning levels', () => {
    const result = rankTaskClass(CLASS, spec({ requirements: { requiresReasoning: true } }), [
      candidate({ model: 'vendor/plain' }),
      candidate({ model: 'vendor/thinker', supportsReasoning: true }),
    ])

    expect(result.kind).toBe('selected')
    if (result.kind !== 'selected') return
    expect(result.winner.model).toBe('vendor/thinker')
    expect(result.rejected).toEqual([{ model: 'vendor/plain', reason: 'exposes no selectable reasoning levels' }])
  })

  it('requires every declared input modality', () => {
    const result = rankTaskClass(CLASS, spec({ requirements: { inputModalities: ['text', 'image'] } }), [
      candidate({ model: 'vendor/text-only', inputModalities: ['text'] }),
      candidate({ model: 'vendor/multimodal', inputModalities: ['text', 'image'] }),
    ])

    expect(result.kind).toBe('selected')
    if (result.kind !== 'selected') return
    expect(result.winner.model).toBe('vendor/multimodal')
    expect(result.rejected).toEqual([
      { model: 'vendor/text-only', reason: 'does not accept the required input modality "image"' },
    ])
  })

  it('rejects a candidate that declares no modalities at all', () => {
    const result = rankTaskClass(CLASS, spec({ requirements: { inputModalities: ['image'] } }), [
      candidate({ model: 'vendor/silent' }),
    ])

    expect(result.rejected[0]?.reason).toBe('declares no input modalities, so it cannot prove image support')
  })

  it('reports an eligible model outside every tier without selecting it', () => {
    const result = rankTaskClass(CLASS, spec({
      tiers: [{ name: 'trusted', modelPatterns: ['vendor/*'] }],
    }), [candidate({ model: 'newcomer/model' })])

    expect(result.kind).toBe('unsatisfied')
    if (result.kind !== 'unsatisfied') return
    expect(result.observed).toEqual(['newcomer/model'])
    expect(result.eligible).toEqual(['newcomer/model'])
    expect(result.detail).toBe(
      'task class "standard" observed 1 eligible model(s) outside every declared preference tier: newcomer/model',
    )
  })

  it('treats an empty modality list as no modality requirement', () => {
    const result = rankTaskClass(CLASS, spec({ requirements: { inputModalities: [] } }), [
      candidate({ model: 'vendor/plain' }),
    ])

    expect(result.kind).toBe('selected')
  })

  it('fails when the matched tier publishes no usable price', () => {
    const result = rankTaskClass(CLASS, spec(), [
      candidate({ model: 'vendor/a', inputUsdPerToken: null }),
      candidate({ model: 'vendor/b', outputUsdPerToken: null }),
    ])

    expect(result.kind).toBe('unsatisfied')
    if (result.kind !== 'unsatisfied') return
    expect(result.detail).toBe('every candidate in tier "preferred" of task class "standard" publishes no usable price')
    expect(result.rejected).toEqual([
      { model: 'vendor/a', reason: 'tier "preferred" matched but the model publishes no usable price' },
      { model: 'vendor/b', reason: 'tier "preferred" matched but the model publishes no usable price' },
    ])
  })

  it('skips an unpriceable candidate when a priceable one shares the tier', () => {
    const result = rankTaskClass(CLASS, spec(), [
      candidate({ model: 'vendor/unpriced', inputUsdPerToken: null }),
      candidate({ model: 'vendor/priced' }),
    ])

    expect(result.kind).toBe('selected')
    if (result.kind !== 'selected') return
    expect(result.winner.model).toBe('vendor/priced')
    expect(result.runnerUp).toBeUndefined()
    expect(result.rejected).toEqual([
      { model: 'vendor/unpriced', reason: 'tier "preferred" matched but the model publishes no usable price' },
    ])
  })

  it('fails when the provider scope offers nothing at all', () => {
    const result = rankTaskClass(CLASS, spec(), [])

    expect(result.kind).toBe('unsatisfied')
    if (result.kind !== 'unsatisfied') return
    expect(result.detail).toBe('no candidate in scope satisfies the declared requirements of task class "standard"')
    expect(result.eligible).toEqual([])
    expect(result.observed).toEqual([])
    expect(result.rejected).toEqual([])
  })
})
