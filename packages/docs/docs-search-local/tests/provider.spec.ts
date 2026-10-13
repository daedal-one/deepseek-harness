/**
 * Provider behavior over a temporary corpus: incremental re-index proven by
 * stub call counts, hybrid fusion surfacing a lexical-only and a semantic-only
 * match, kind filtering, degradation without a model, and snippet bounds.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Jobs from '@deepseek-ai/dsh-jobs-local'
import { DocsIndexStore } from '../src/store.ts'
import { Context } from '@deepseek-ai/cordis'
import {
  DOCS_SEARCH_ALLOWED_DIMENSIONS,
  LocalDocsSearchService,
  resolveConfig,
  sanitizeFtsQuery,
  type Config,
} from '../src/index.ts'
import type { DocsEmbedder } from '../src/embedder.ts'
import { stubEmbedder, vectorOf, type EmbedCall } from './stub-embedder.ts'

let root: string | undefined
let context: Context | undefined

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-docs-search-'))
})

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.restoreAllMocks()
})

/** Write one corpus fixture file. */
async function fixture(path: string, contents: string): Promise<void> {
  const absolute = join(root!, path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, contents)
}

/** Shared state the stub subclass reads, keyed by the fiber's plugin call. */
interface StubState {
  /** Calls the provider issued to the embedder, in order. */
  calls: EmbedCall[]
  /** Whether embedder preparation must fail, proving the degraded path. */
  failModel: boolean
  /** Fail the next document batch after observing its inputs. */
  failBatch?: boolean
  /** Block a controlled native call until the test releases it. */
  waitForDocs?: () => Promise<void>
  /** Block a controlled query call until the test releases it. */
  waitForQuery?: () => Promise<void>
  /** Observe native resource release. */
  disposed?: number
  /** Return a malformed batch count from the native adapter. */
  shortBatch?: boolean
  /** Fail native query inference while leaving the lexical store available. */
  failQuery?: boolean
  /** The instance the plugin call constructed. */
  created?: LocalDocsSearchService
}

/**
 * A provider whose embedder is the deterministic stub. The subclass is
 * constructed by the Loader, so the stub state travels through a mutable
 * holder the factory closes over.
 */
function stubServiceClass(state: StubState): typeof LocalDocsSearchService {
  const created = (instance: LocalDocsSearchService): void => { state.created = instance }
  return class StubDocsSearch extends LocalDocsSearchService {
    constructor(ctx: Context, config: Config) {
      super(ctx, config)
      created(this)
    }

    protected override async createEmbedder(): Promise<DocsEmbedder | undefined> {
      if (state.failModel) {
        this.recordDegradation('embedding model "test" is unavailable: admission refused')
        return undefined
      }
      const embedder = stubEmbedder(this.config.dimensions, state.calls)
      const embedDocs = embedder.embedDocs.bind(embedder)
      embedder.embedDocs = async (titles, bodies) => {
        await state.waitForDocs?.()
        const vectors = await embedDocs(titles, bodies)
        if (state.failBatch) throw new Error('embedding batch failed')
        return state.shortBatch ? [] : vectors
      }
      const embedQuery = embedder.embedQuery.bind(embedder)
      embedder.embedQuery = async (text) => { await state.waitForQuery?.(); if (state.failQuery) throw new Error('native inference failed'); return embedQuery(text) }
      embedder.dispose = async () => { state.disposed = (state.disposed ?? 0) + 1 }
      this.useEmbedder(embedder)
      return embedder
    }
  }
}

/** One mounted provider plus the stub state its embedder reports into. */
interface Mounted {
  /** The live provider instance. */
  service: LocalDocsSearchService
  /** Recorded embedder calls. */
  calls: EmbedCall[]
  /** Flip to make the next embedder preparation fail. */
  state: StubState
}

/** Mount one provider over `root` with an ephemeral index and the stub embedder. */
async function mount(config: Config = {}, withJobs = false): Promise<Mounted> {
  context = new Context()
  if (withJobs) {
    await context.plugin(Jobs, { maxConcurrentJobsPerOwner: 8 })
    context.jobs.attachController('docs-search-test')
  }
  const state: StubState = { calls: [], failModel: false }
  await context.plugin(stubServiceClass(state), {
    root: root!,
    indexPath: ':memory:',
    corpus: [
      { kind: 'subsystem', root: 'corpus/subsystems', suffix: '.md', recursive: false, packageReadme: false },
      { kind: 'readme', root: 'packages', suffix: 'README.md', recursive: true, packageReadme: true },
      { kind: 'note', root: 'corpus/notes', suffix: '.md', recursive: true, packageReadme: false },
    ],
    ...config,
  })
  const service = state.created
  if (service === undefined) throw new Error('the stub provider did not construct')
  return { service, calls: state.calls, state }
}

/** Every embedder call count, summed. */
function embeddedDocuments(calls: readonly EmbedCall[]): number {
  return calls.filter(call => !call.query).reduce((sum, call) => sum + call.count, 0)
}

describe('docs-search provider', () => {
  it('indexes the corpus and answers a lexical query', async () => {
    await fixture('corpus/subsystems/session-query.md', '# Session Query\n\n## Logical records\n\nA record carries availability flags.\n')
    await fixture('corpus/subsystems/shell.md', '# Shell\n\n## Executor\n\nBash runs commands.\n')
    const { service } = await mount()
    expect(service.status()).toEqual({ chunks: 0, indexed: 0, modelReady: false, building: false })

    service.reindex()
    await settle(service)

    const status = service.status()
    expect(status.chunks).toBe(4)
    expect(status.indexed).toBe(2)
    expect(status.modelReady).toBe(true)
    expect(status.lastError).toBeUndefined()

    const results = await service.search({ query: 'availability flags' })
    expect(results.map(result => `${result.file}#${result.anchor}`)).toContain('corpus/subsystems/session-query.md#logical-records')
    expect(results[0]!.source).toBe('subsystem')
    expect(results[0]!.arms.lexical).toBeDefined()
  })

  it('re-embeds only chunks whose body changed', async () => {
    await fixture('corpus/subsystems/a.md', '# A\n\n## One\n\nalpha\n')
    await fixture('corpus/subsystems/b.md', '# B\n\n## Two\n\nbeta\n')
    const { service, calls } = await mount()
    service.reindex()
    await settle(service)
    const afterFirst = embeddedDocuments(calls)
    expect(afterFirst).toBe(4)

    // Nothing changed: a second build embeds nothing at all.
    service.reindex()
    await settle(service)
    expect(embeddedDocuments(calls)).toBe(afterFirst)

    // One section changes: exactly that chunk is re-embedded.
    await fixture('corpus/subsystems/a.md', '# A\n\n## One\n\nalpha rewritten\n')
    service.reindex()
    await settle(service)
    expect(embeddedDocuments(calls)).toBe(afterFirst + 1)

    // One file vanishes: its chunks are deleted and nothing is re-embedded.
    await rm(join(root!, 'corpus/subsystems/b.md'))
    service.reindex()
    await settle(service)
    expect(embeddedDocuments(calls)).toBe(afterFirst + 1)
    expect(service.status().chunks).toBe(2)
    expect(service.status().indexed).toBe(1)
  })

  it('surfaces a semantic-only hit the lexical arm cannot rank', async () => {
    // The chunk body never contains the query token, so BM25 cannot match it;
    // the stub's bag-of-tokens embedder still places the chunk's title token
    // near the query, which is what a real embedding model does for a
    // vocabulary-gap query.
    await fixture('corpus/subsystems/a.md', '# Retrieval\n\n## Subject\n\nindex internals\n')
    await fixture('corpus/subsystems/b.md', '# B\n\n## Aside\n\nunrelated\n')
    const { service } = await mount()
    service.reindex()
    await settle(service)

    const results = await service.search({ query: 'retrieval' })
    expect(results.length).toBeGreaterThan(0)
    // The matched chunk is the one whose title carries the token; the lexical
    // arm cannot see the body, so this hit is semantic-only.
    const semanticOnly = results.filter(result => result.arms.semantic !== undefined)
    expect(semanticOnly.length).toBeGreaterThan(0)
  })

  it('surfaces a lexical-only match when the semantic arm is degraded', async () => {
    await fixture('corpus/subsystems/a.md', '# A\n\n## Subject\n\nquasar observations\n')
    const { service, state, calls } = await mount()
    state.failModel = true
    service.reindex()
    await settle(service)

    const status = service.status()
    expect(status.modelReady).toBe(false)
    expect(status.lastError).toMatch(/unavailable/)

    const results = await service.search({ query: 'quasar' })
    expect(results.length).toBeGreaterThan(0)
    for (const result of results) {
      expect(result.arms.lexical).toBeDefined()
      expect(result.arms.semantic).toBeUndefined()
    }
    // The query embedding is never even attempted while the model is absent.
    expect(calls.filter(call => call.query)).toEqual([])
  })

  it('preserves the previous complete index on embedding failure and retries changed chunks', async () => {
    await fixture('corpus/subsystems/a.md', '# A\n\n## Subject\n\nquasar original\n')
    const { service, state, calls } = await mount({ batchSize: 1 })
    service.reindex()
    await settle(service)
    const before = await service.search({ query: 'quasar' })
    await fixture('corpus/subsystems/a.md', '# A\n\n## Subject\n\nnebula replacement\n')
    state.failBatch = true
    service.reindex()
    await settle(service)
    expect(service.status().lastError).toContain('embedding batch failed')
    expect(await service.search({ query: 'quasar' })).toEqual(before)

    state.failBatch = false
    const attempted = embeddedDocuments(calls)
    service.reindex()
    await settle(service)
    expect(embeddedDocuments(calls)).toBe(attempted + 1)
    expect(service.status().lastError).toBeUndefined()
    const results = await service.search({ query: 'nebula' })
    expect(results.find(result => result.anchor === 'subject')).toMatchObject({
      snippet: 'nebula replacement',
    })
    expect(results.find(result => result.anchor === 'subject')?.arms.semantic).toBeTypeOf('number')
    expect(results.find(result => result.anchor === 'subject')?.arms.lexical).toBeTypeOf('number')
  })

  it('repairs unchanged lexical-only chunks when the model becomes available', async () => {
    await fixture('corpus/subsystems/a.md', '# A\n\n## Subject\n\nquasar observations\n')
    const { service, state, calls } = await mount()
    state.failModel = true
    service.reindex()
    await settle(service)
    expect(service.status().modelReady).toBe(false)
    state.failModel = false
    service.reindex()
    await settle(service)
    expect(service.status()).toMatchObject({ modelReady: true, chunks: 2 })
    expect(service.status().lastError).toBeUndefined()
    expect(embeddedDocuments(calls)).toBe(2)
    expect((await service.search({ query: 'quasar' })).some(result => result.arms.semantic !== undefined)).toBe(true)
  })

  it('retains lexical search when native query inference fails and reports recovery', async () => {
    await fixture('corpus/subsystems/a.md', '# A\n\nquasar\n')
    const { service, state } = await mount()
    service.reindex()
    await settle(service)
    state.failQuery = true
    const results = await service.search({ query: 'quasar' })
    expect(results).toHaveLength(1)
    expect(results[0]?.arms.semantic).toBeUndefined()
    expect(service.status().lastError).toContain('native inference failed')
    state.failQuery = false
    expect((await service.search({ query: 'quasar' }))[0]?.arms.semantic).toBeDefined()
    expect(service.status().lastError).toBeUndefined()
  })

  it('fuses two arms into one ranking when both rank a chunk', async () => {
    await fixture('corpus/subsystems/a.md', '# A\n\n## Target\n\nhybrid retrieval over documentation\n')
    await fixture('corpus/subsystems/b.md', '# B\n\n## Noise\n\nnothing relevant here at all\n')
    const { service } = await mount()
    service.reindex()
    await settle(service)

    const results = await service.search({ query: 'hybrid retrieval' })
    const target = results.find(result => result.anchor === 'target')
    expect(target).toBeDefined()
    expect(target!.arms.lexical).toBeDefined()
    expect(target!.arms.semantic).toBeDefined()
    expect(results[0]!.anchor).toBe('target')
  })

  it('restricts results to the requested kind', async () => {
    await fixture('corpus/subsystems/a.md', '# A\n\n## Subject\n\nquasar here\n')
    await fixture('packages/util/brand/README.md', '# docs-search\n\n## Subject\n\nquasar here too\n')
    await fixture('corpus/notes/implemented/feature/x.md', '# Note\n\n## Subject\n\nquasar in a note\n')
    const { service } = await mount()
    service.reindex()
    await settle(service)

    const all = await service.search({ query: 'quasar' })
    expect(new Set(all.map(result => result.source))).toEqual(new Set(['subsystem', 'readme', 'note']))

    const notes = await service.search({ query: 'quasar', kind: 'note' })
    expect(notes.length).toBeGreaterThan(0)
    expect(notes.every(result => result.source === 'note')).toBe(true)

    const subsystems = await service.search({ query: 'quasar', kind: 'subsystem' })
    expect(subsystems.every(result => result.source === 'subsystem')).toBe(true)
  })

  it('honors the requested limit and the configured maximum', async () => {
    for (let index = 0; index < 6; index += 1) {
      await fixture(`corpus/subsystems/s${index}.md`, `# S${index}\n\n## Subject\n\nquasar number ${index}\n`)
    }
    const { service } = await mount({ defaultLimit: 2, maxLimit: 40 })
    service.reindex()
    await settle(service)

    expect(await service.search({ query: 'quasar' })).toHaveLength(2)
    expect(await service.search({ query: 'quasar', limit: 4 })).toHaveLength(4)
    await expect(service.search({ query: 'quasar', limit: 41 })).rejects.toThrow(/between 1 and 40/)
  })

  it('bounds every snippet to the configured character budget', async () => {
    await fixture('corpus/subsystems/a.md', `# A\n\n## Long\n\n${'word '.repeat(200)}\n`)
    const { service } = await mount({ snippetChars: 60 })
    service.reindex()
    await settle(service)

    const results = await service.search({ query: 'word' })
    expect(results.length).toBeGreaterThan(0)
    for (const result of results) {
      expect(Array.from(result.snippet).length).toBeLessThanOrEqual(60)
    }
  })

  it('never carries a full section body in a result', async () => {
    const body = `unique-tail-marker ${'filler '.repeat(300)}`
    await fixture('corpus/subsystems/a.md', `# A\n\n## Long\n\n${body}\n`)
    const { service } = await mount({ snippetChars: 100 })
    service.reindex()
    await settle(service)

    const results = await service.search({ query: 'unique' })
    expect(results.length).toBeGreaterThan(0)
    for (const result of results) {
      expect(result.snippet).not.toContain('unique-tail-marker filler'.repeat(3))
    }
  })

  it('keeps a chunk that carries only a fenced code block locatable', async () => {
    const code = Array.from({ length: 60 }, (_, index) => `const v${index} = ${index}`)
    await fixture('corpus/subsystems/code.md', [
      '# Code',
      '',
      '## Sample',
      '',
      '```ts',
      ...code,
      '```',
      '',
    ].join('\n'))
    const { service } = await mount()
    service.reindex()
    await settle(service)

    const status = service.status()
    expect(status.chunks).toBe(2)
    const results = await service.search({ query: 'sample' })
    expect(results.some(result => result.anchor === 'sample')).toBe(true)
  })

  it('reports building while a build runs and still answers', async () => {
    await fixture('corpus/subsystems/a.md', '# A\n\n## Subject\n\nquasar here\n')
    const { service } = await mount()
    service.reindex()
    // `building` is observable synchronously, before the build's first await.
    expect(service.status().building).toBe(true)
    // A search issued during the build answers instead of waiting or failing.
    await expect(service.search({ query: 'quasar' })).resolves.toBeInstanceOf(Array)
    await settle(service)
    expect(service.status().building).toBe(false)
    expect(service.status().chunks).toBeGreaterThan(0)
  })

  it('returns no job id when no job runtime is mounted', async () => {
    await fixture('corpus/subsystems/a.md', '# A\n\n## Subject\n\nquasar\n')
    const { service } = await mount()
    expect(service.reindex()).toEqual({})
    expect(service.reindex()).toEqual({})
    await settle(service)
  })

  it('rejects a blank query and a query with no searchable token', async () => {
    await fixture('corpus/subsystems/a.md', '# A\n\n## Subject\n\nquasar\n')
    const { service } = await mount()
    service.reindex()
    await settle(service)
    await expect(service.search({ query: '   ' })).rejects.toThrow(/must contain letters or digits/)
    await expect(service.search({ query: '***' })).rejects.toThrow(/must contain letters or digits/)
  })

  it('treats an FTS5 operator in a query as data', async () => {
    await fixture('corpus/subsystems/a.md', '# A\n\n## Subject\n\nalpha beta\n')
    const { service } = await mount()
    service.reindex()
    await settle(service)
    // A bare `AND` would be a syntax error or an operator if it reached FTS5.
    const results = await service.search({ query: 'alpha AND beta' })
    expect(results.some(result => result.anchor === 'subject')).toBe(true)
  })

  it('retries unavailable vector extensions and embeds unchanged lexical rows', async () => {
    await fixture('corpus/subsystems/a.md', '# A\n\nquasar\n')
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reapplied to the spy receiver and restored after the test.
    const load = DocsIndexStore.prototype.loadVectorExtension
    let available = false
    vi.spyOn(DocsIndexStore.prototype, 'loadVectorExtension').mockImplementation(function (this: DocsIndexStore, ...args) {
      return available ? load.apply(this, args) : Promise.resolve('fixture extension unavailable')
    })
    const { service, calls } = await mount()
    service.reindex()
    await settle(service)
    expect(service.status().lastError).toContain('extension unavailable')
    expect((await service.search({ query: 'quasar' }))[0]?.arms.semantic).toBeUndefined()
    available = true
    service.reindex()
    await settle(service)
    expect(embeddedDocuments(calls)).toBe(1)
    expect(service.status().lastError).toBeUndefined()
    expect((await service.search({ query: 'quasar' }))[0]?.arms.semantic).toBeDefined()
  })

  it('waits for native inference on disposal and cancels the uncommitted build', async () => {
    await fixture('corpus/subsystems/a.md', '# A\n\nquasar\n')
    const path = join(root!, 'dispose.sqlite')
    const { service, state } = await mount({ indexPath: path })
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    state.waitForDocs = async () => { entered.resolve(undefined); await release.promise }
    service.reindex()
    await entered.promise
    let disposed = false
    const disposal = context!.fiber.dispose().then(() => { disposed = true })
    try {
      await new Promise(resolve => setImmediate(resolve))
      expect(disposed).toBe(false)
      expect(state.disposed).toBeUndefined()
      expect(() => service.reindex()).toThrow('disposed')
      await expect(service.search({ query: 'quasar' })).rejects.toThrow('disposed')
    } finally { release.resolve(undefined); await disposal }
    expect(state.disposed).toBe(1)
    const stored = await DocsIndexStore.open(path)
    try { expect(stored.chunkCount()).toBe(0) } finally { stored.close() }
  })

  it('keeps the store open until a pending search finishes during disposal', async () => {
    await fixture('corpus/subsystems/a.md', '# A\n\nquasar\n')
    const { service, state } = await mount()
    service.reindex()
    await settle(service)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    state.waitForQuery = async () => { entered.resolve(undefined); await release.promise }
    const search = service.search({ query: 'quasar' })
    await entered.promise
    const disposal = context!.fiber.dispose()
    release.resolve(undefined)
    try { expect(await search).toHaveLength(1) } finally { await disposal }
    expect(state.disposed).toBe(1)
  })

  it('closes a store that finishes opening after disposal starts', async () => {
    const open = DocsIndexStore.open.bind(DocsIndexStore)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const close = vi.spyOn(DocsIndexStore.prototype, 'close')
    vi.spyOn(DocsIndexStore, 'open').mockImplementation(async (path) => {
      entered.resolve(undefined)
      await release.promise
      return open(path)
    })
    await mount({ openAtStart: true })
    await entered.promise
    const disposal = context!.fiber.dispose()
    release.resolve(undefined)
    await disposal
    expect(close).toHaveBeenCalledOnce()
  })

  it('reports store open failures and retries on the next request', async () => {
    const open = vi.spyOn(DocsIndexStore, 'open').mockRejectedValueOnce('fixture open failed')
    const { service } = await mount({ openAtStart: true })
    await vi.waitFor(() => { expect(service.status().lastError).toContain('fixture open failed') })
    expect(open).toHaveBeenCalledOnce()
    await expect(service.search({ query: 'quasar' })).resolves.toEqual([])
  })

  it('refuses malformed embedding batch counts before committing', async () => {
    await fixture('corpus/subsystems/a.md', '# A\n\nquasar\n')
    const { service, state } = await mount()
    state.shortBatch = true
    service.reindex()
    await settle(service)
    expect(service.status().lastError).toContain('unexpected number of vectors')
    expect(service.status().chunks).toBe(0)
  })

  it.each(['completed', 'failed', 'killed'] as const)('settles a registry build as %s without rejecting its job promise', async (status) => {
    await fixture('corpus/subsystems/a.md', '# A\n\nquasar\n')
    const { service, state } = await mount({}, true)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    state.waitForDocs = async () => { entered.resolve(undefined); await release.promise }
    state.failBatch = status === 'failed'
    const handle = service.reindex()
    expect(handle.jobId).toBeDefined()
    expect(service.reindex()).toEqual(handle)
    await entered.promise
    const job = context!.jobs.list()[0]!
    try {
      if (status === 'killed') context!.jobs.kill(job.id)
    } finally { release.resolve(undefined) }
    await settle(service)
    await vi.waitFor(() => { expect(context!.jobs.get(job.id).status).toBe(status) })
    expect(service.status().chunks).toBe(status === 'completed' ? 1 : 0)
  })

})

describe('config resolution', () => {
  it('defaults every deployment-varying field', () => {
    const resolved = resolveConfig({})
    expect(resolved.root).toBe(process.cwd())
    expect(resolved.corpus).toEqual([])
    expect(resolved.modelId).toBe('onnx-community/embeddinggemma-300m-ONNX')
    expect(resolved.dtype).toBe('q8')
    expect(resolved.dimensions).toBe(256)
    expect(resolved.batchSize).toBe(16)
    expect(resolved.maxCodeLines).toBe(40)
    expect(resolved.defaultLimit).toBe(8)
    expect(resolved.maxLimit).toBe(50)
    expect(resolved.snippetChars).toBe(240)
    expect(resolved.indexPath.endsWith(join('docs-index', 'docs-search.sqlite'))).toBe(true)
    expect(resolved.cacheRoot.endsWith('models')).toBe(true)
    expect(resolved.localModelPath).toBeUndefined()
  })

  it('accepts every allowed vector width and refuses any other', () => {
    for (const dimensions of DOCS_SEARCH_ALLOWED_DIMENSIONS) {
      expect(resolveConfig({ dimensions }).dimensions).toBe(dimensions)
    }
    expect(() => resolveConfig({ dimensions: 300 })).toThrow(/dimensions/)
  })

  it('refuses a blank path and an inverted limit pair', () => {
    expect(() => resolveConfig({ root: '  ' })).toThrow(/root must not be blank/)
    expect(() => resolveConfig({ indexPath: '' })).toThrow(/indexPath must not be blank/)
    expect(() => resolveConfig({ modelId: ' ' })).toThrow(/modelId must not be blank/)
    expect(() => resolveConfig({ cacheRoot: ' ' })).toThrow(/cacheRoot must not be blank/)
    expect(() => resolveConfig({ localModelPath: '' })).toThrow(/localModelPath must not be blank/)
    expect(() => resolveConfig({ batchSize: 0 })).toThrow(/batchSize/)
    expect(() => resolveConfig({ defaultLimit: 30, maxLimit: 10 })).toThrow(/defaultLimit must be less than or equal to maxLimit/)
  })

  it('refuses a corpus rule without a root or suffix', () => {
    expect(() => resolveConfig({
      corpus: [{ kind: 'note', root: '', suffix: '.md', recursive: true, packageReadme: false }],
    })).toThrow(/non-blank root/)
    expect(() => resolveConfig({
      corpus: [{ kind: 'note', root: '.', suffix: '', recursive: true, packageReadme: false }],
    })).toThrow(/non-blank suffix/)
  })
})

describe('embedder formatting', () => {
  it('prefixes documents and queries verbatim', async () => {
    const { documentText, queryText } = await import('../src/embedder.ts')
    expect(documentText('Logical records', 'body')).toBe('title: Logical records | text: body')
    expect(documentText('', 'body')).toBe('title: none | text: body')
    expect(queryText('hybrid search')).toBe('task: search result | query: hybrid search')
  })

  it('re-normalizes after truncation so a truncated vector is unit length', async () => {
    const { truncateAndNormalize } = await import('../src/embedder.ts')
    const full = new Array<number>(768).fill(0)
    full[0] = 3
    full[1] = 4
    full[700] = 100
    const truncated = truncateAndNormalize(full, 256)
    expect(truncated).toHaveLength(256)
    const norm = Math.sqrt(truncated.reduce((sum, value) => sum + value * value, 0))
    expect(norm).toBeCloseTo(1, 12)
    // Only the retained dimensions contribute, so the discarded mass behind
    // dimension 256 never reaches the stored vector.
    expect(truncated[0]).toBeCloseTo(0.6, 12)
    expect(truncated[1]).toBeCloseTo(0.8, 12)
  })

  it('keeps the stub vectors unit length so the arm scores are comparable', () => {
    const vector = vectorOf('hybrid retrieval', 16)
    expect(Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1, 12)
  })
})

describe('FTS5 expression building', () => {
  it('quotes every token for the indexed corpus', () => {
    expect(sanitizeFtsQuery('Logical records')).toBe('"logical" OR "records"')
  })
})

/**
 * Wait until no build is running. A build is asynchronous, so the first turn
 * of the event loop always runs before the flag can be observed as cleared.
 */
async function settle(service: LocalDocsSearchService): Promise<void> {
  await new Promise(resolve => setImmediate(resolve))
  for (let attempt = 0; attempt < 2_000 && service.status().building; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  await new Promise(resolve => setImmediate(resolve))
  expect(service.status().building, 'build did not settle').toBe(false)
}
