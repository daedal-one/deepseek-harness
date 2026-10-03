import { afterEach, describe, expect, it, vi } from 'vitest'
import { OperationCandidateId, OperationJudgmentRequestId, OperationRunId } from '@deepseek-ai/dsh-experimental-operation'
import type { OperationJudgmentDraft, OperationTokenizer } from '@deepseek-ai/dsh-experimental-operation'
import { ClmHttpProvider } from '../src/provider.ts'

const config = {
  endpoint: 'http://127.0.0.1/v1/systemone', tokenizerId: 'batch-fixture', model: 'fixture-model', encoder: 'fixture-encoder',
  deployment: 'fixture-deployment', providerId: 'clm-http', serialization: 'clm-systemone-bb42c6c5', temperature: 1,
  maxEncoderTokens: 7, timeoutMs: 1_000, maxResponseBytes: 2_048,
}
const draft: OperationJudgmentDraft = {
  id: OperationJudgmentRequestId('batch-request'), runId: OperationRunId('batch-run'), kind: 'continuation',
  state: { observation: 'exact' }, question: 'select one',
  candidates: [
    { id: OperationCandidateId('continue-0'), kind: 'continue', nextStep: 'next', arguments: { target: 'alpha' }, description: 'continue alpha' },
    { id: OperationCandidateId('needs-replan'), kind: 'needs-replan', description: 'replan' },
  ],
}
const texts = ['observation: exact\n\nselect one', 'continue alpha', 'replan']
const providers: ClmHttpProvider[] = []

afterEach(async () => {
  await Promise.all(providers.splice(0).map(provider => provider.dispose()))
})

function provider(tokenizer: OperationTokenizer, maxEncoderTokens = config.maxEncoderTokens) {
  const result = new ClmHttpProvider({ ...config, maxEncoderTokens }, tokenizer)
  providers.push(result)
  return result
}

function prepare(tokenizer: OperationTokenizer, maxEncoderTokens?: number) {
  return provider(tokenizer, maxEncoderTokens).prepare(draft, new AbortController().signal)
}

describe('CLM exact batch preparation', () => {
  it('prefers exactly one batch call and retains all full encoder inputs and their summed counts', async () => {
    const count = vi.fn(async () => { throw new Error('scalar must not run') })
    const countMany = vi.fn(async () => Object.freeze([0, 7, 3]))
    const result = await prepare({ id: config.tokenizerId, count, countMany })
    expect(count).not.toHaveBeenCalled()
    expect(countMany).toHaveBeenCalledTimes(1)
    expect(countMany).toHaveBeenCalledWith(texts, expect.any(AbortSignal))
    expect(result.inputTokens).toBe(10)
    expect(result.encoding).toEqual({ maxTokensPerText: 7, inputs: texts.map((text, index) => ({ text, tokens: [0, 7, 3][index] })) })
  })

  it('preserves scalar fallback input ordering and the same recorded encoding', async () => {
    const scalarCounts = [0, 7, 3]
    let index = 0
    const count = vi.fn(async () => scalarCounts[index++]!)
    const scalar = await prepare({ id: config.tokenizerId, count })
    const batch = await prepare({ id: config.tokenizerId, count, async countMany() { return [0, 7, 3] } })
    expect(count.mock.calls).toHaveLength(3)
    expect(count).toHaveBeenNthCalledWith(1, texts[0], expect.any(AbortSignal))
    expect(count).toHaveBeenNthCalledWith(2, texts[1], expect.any(AbortSignal))
    expect(count).toHaveBeenNthCalledWith(3, texts[2], expect.any(AbortSignal))
    expect(scalar).toEqual(batch)
  })

  it.each([[], [1, 2], [1, 2, 3, 4]].map(counts => ({ counts })))('rejects wrong batch cardinality $counts without scalar fallback', async ({ counts }) => {
    const count = vi.fn(async () => 1)
    await expect(prepare({ id: config.tokenizerId, count, async countMany() { return counts } }))
      .rejects.toMatchObject({ code: 'CLM_TOKENIZER' })
    expect(count).not.toHaveBeenCalled()
  })

  it.each(['scalar', 'batch'] as const)('rejects invalid %s counts, per-text overflow, and unsafe total accounting', async (mode) => {
    for (const { counts, ceiling, code } of [
      ...[-1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1].map(invalid => ({ counts: [0, invalid, 0], ceiling: 7, code: 'CLM_TOKENIZER' })),
      { counts: [0, 8, 0], ceiling: 7, code: 'CLM_INPUT_LIMIT' },
      { counts: [Number.MAX_SAFE_INTEGER, 1, 0], ceiling: Number.MAX_SAFE_INTEGER, code: 'CLM_TOKENIZER' },
    ]) {
      let index = 0
      const count = vi.fn(async () => counts[index++]!)
      const tokenizer: OperationTokenizer = {
        id: config.tokenizerId, count,
        ...(mode === 'batch' ? { countMany: async () => counts } : {}),
      }
      await expect(prepare(tokenizer, ceiling)).rejects.toMatchObject({ code })
      if (mode === 'batch') expect(count).not.toHaveBeenCalled()
    }
  })

  it('accepts a safely summed exact maximum without rounding or cache-dependent accounting', async () => {
    const result = await prepare({
      id: config.tokenizerId, async count() { throw new Error('scalar must not run') },
      async countMany() { return [Number.MAX_SAFE_INTEGER - 2, 1, 1] },
    }, Number.MAX_SAFE_INTEGER)
    expect(result.inputTokens).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('rejects sparse batch counts without treating absent entries as zero', async () => {
    await expect(prepare({ id: config.tokenizerId, async count() { return 0 }, async countMany() { return new Array<number>(3) } }))
      .rejects.toMatchObject({ code: 'CLM_TOKENIZER' })
  })

  it('does not retry a failed batch through scalar calls', async () => {
    const count = vi.fn(async () => 1)
    const countMany = vi.fn(async () => { throw new Error('tokenizer unavailable') })
    await expect(prepare({ id: config.tokenizerId, count, countMany })).rejects.toMatchObject({ code: 'CLM_TOKENIZER' })
    expect(countMany).toHaveBeenCalledTimes(1)
    expect(count).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'dispose'] as const)('retains ownership of a pending batch during %s and never returns late counts', async (mode) => {
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<readonly number[]>()
    let signal: AbortSignal | undefined
    const count = vi.fn(async () => 1)
    const instance = provider({
      id: config.tokenizerId, count,
      async countMany(_texts, ownedSignal) {
        signal = ownedSignal
        entered.resolve(undefined)
        return await release.promise
      },
    })
    const controller = new AbortController()
    const task = instance.prepare(draft, controller.signal).catch((error: unknown) => error)
    await entered.promise
    let disposed = false
    let disposing: Promise<void> | undefined
    if (mode === 'cancel') controller.abort()
    else disposing = instance.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(signal?.aborted).toBe(true)
    expect(disposed).toBe(false)
    release.resolve([1, 1, 1])
    await disposing
    expect(await task).toMatchObject({ code: mode === 'cancel' ? 'CLM_CANCELLED' : 'CLM_DISPOSED' })
    expect(count).not.toHaveBeenCalled()
  })

  it('does not start a batch for an already-cancelled preparation', async () => {
    const countMany = vi.fn(async () => [1, 1, 1])
    const instance = provider({ id: config.tokenizerId, async count() { return 1 }, countMany })
    await expect(instance.prepare(draft, AbortSignal.abort())).rejects.toMatchObject({ code: 'CLM_CANCELLED' })
    expect(countMany).not.toHaveBeenCalled()
  })
})
