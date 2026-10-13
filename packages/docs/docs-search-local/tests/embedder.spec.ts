/** Model-runtime loading, tensor validation, and native-resource ownership. */
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createDocsEmbedder, truncateAndNormalize, type DocsEmbedderConfig } from '../src/embedder.ts'
import LocalDocsSearchService from '../src/index.ts'

const runtime = vi.hoisted(() => ({ pipeline: vi.fn(), env: Object.freeze({ allowRemoteModels: true }) }))
vi.mock('@huggingface/transformers', () => runtime)
const config: DocsEmbedderConfig = { modelId: 'fixture/model', dtype: 'q8', dimensions: 128, cacheRoot: '/fixture/cache', batchSize: 2 }
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  vi.resetAllMocks()
})

function pipeline() {
  const extract = Object.assign(vi.fn(async (texts: string[]) => ({
    dims: [texts.length, 768], data: new Float32Array(texts.length * 768).fill(1),
  })), { dispose: vi.fn(async () => {}) })
  runtime.pipeline.mockResolvedValue(extract)
  return extract
}

describe('embedding runtime', () => {
  it('uses per-instance loading options, batches document prefixes, and releases the pipeline', async () => {
    const extract = pipeline()
    const loaded = await createDocsEmbedder(config)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) throw new Error(loaded.reason)
    try {
      expect(runtime.pipeline).toHaveBeenCalledWith('feature-extraction', 'fixture/model', {
        dtype: 'q8', cache_dir: '/fixture/cache', local_files_only: false,
      })
      const vectors = await loaded.embedder.embedDocs(['A', '', 'C'], ['alpha', 'beta', 'gamma'])
      expect(vectors).toHaveLength(3)
      expect(extract.mock.calls.map(call => call[0])).toEqual([
        ['title: A | text: alpha', 'title: none | text: beta'], ['title: C | text: gamma'],
      ])
      expect(await loaded.embedder.embedQuery('question')).toHaveLength(128)
      expect(extract.mock.calls.at(-1)?.[0]).toEqual(['task: search result | query: question'])
    } finally { await loaded.embedder.dispose() }
    expect(extract.dispose).toHaveBeenCalledOnce()
  })

  it('loads an absolute local model directory without changing global runtime settings', async () => {
    pipeline()
    const loaded = await createDocsEmbedder({ ...config, localModelPath: './fixture-model' })
    if (!loaded.ok) throw new Error(loaded.reason)
    try {
      expect(runtime.pipeline).toHaveBeenCalledWith('feature-extraction', resolve('./fixture-model'), {
        dtype: 'q8', cache_dir: '/fixture/cache', local_files_only: true,
      })
      expect(runtime.env).toEqual({ allowRemoteModels: true })
    } finally { await loaded.embedder.dispose() }
  })

  it.each([new Error('unavailable'), 'unavailable'])('reports a model load failure without throwing', async (failure) => {
    runtime.pipeline.mockRejectedValue(failure)
    expect(await createDocsEmbedder(config)).toEqual({ ok: false, reason: 'embedding model "fixture/model" is unavailable: unavailable' })
  })

  it.each([
    { dims: [], data: [] },
    { dims: [2, 768], data: new Array<number>(768).fill(1) },
    { dims: [1, 8], data: new Array<number>(8).fill(1) },
    { dims: [1, 768], data: [1] },
  ])('rejects malformed runtime tensor output', async (tensor) => {
    const extract = pipeline()
    extract.mockResolvedValue({ dims: tensor.dims, data: new Float32Array(tensor.data) })
    const loaded = await createDocsEmbedder(config)
    if (!loaded.ok) throw new Error(loaded.reason)
    try { await expect(loaded.embedder.embedQuery('query')).rejects.toThrow('unexpected tensor dimensions') }
    finally { await loaded.embedder.dispose() }
  })

  it.each([[0, 0], [Number.NaN, 1], [Number.POSITIVE_INFINITY, 1], [1]].map(values => ({ values })))('rejects a non-normalizable vector', ({ values }) => {
    expect(() => truncateAndNormalize(values, 2)).toThrow('finite nonzero vector')
  })

  it.each([undefined, './fixture-model'])('prepares and disposes the real provider adapter with local path %s', async (localModelPath) => {
    const extract = pipeline()
    context = new Context()
    await context.plugin(LocalDocsSearchService, {
      root: '/fixture/no-corpus', indexPath: ':memory:',
      ...localModelPath === undefined ? {} : { localModelPath },
    })
    const service = context.docsSearch
    await service.search({ query: 'query' })
    expect(service.status().modelReady).toBe(true)
    await context.fiber.dispose()
    context = undefined
    expect(extract.dispose).toHaveBeenCalledOnce()
  })

  it('reports a failed adapter load through provider status', async () => {
    runtime.pipeline.mockRejectedValue(new Error('weights missing'))
    context = new Context()
    await context.plugin(LocalDocsSearchService, { indexPath: ':memory:' })
    expect(await context.docsSearch.search({ query: 'query' })).toEqual([])
    expect(context.docsSearch.status().lastError).toContain('weights missing')
  })
})

it('shares pending model preparation between search and reindex', async () => {
  const extract = pipeline()
  const preparing = Promise.withResolvers<typeof extract>()
  runtime.pipeline.mockReturnValue(preparing.promise)
  context = new Context()
  await context.plugin(LocalDocsSearchService, { root: '/fixture/no-corpus', indexPath: ':memory:' })
  const service = context.docsSearch
  const search = service.search({ query: 'query' })
  try {
    await vi.waitFor(() => { expect(runtime.pipeline).toHaveBeenCalledOnce() })
    service.reindex()
    await new Promise(resolve => setImmediate(resolve))
    expect(runtime.pipeline).toHaveBeenCalledOnce()
  } finally { preparing.resolve(extract) }
  await search
  await vi.waitFor(() => { expect(service.status().building).toBe(false) })
  await context.fiber.dispose()
  context = undefined
  expect(extract.dispose).toHaveBeenCalledOnce()
})
