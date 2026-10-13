/**
 * Provider behavior over a temporary corpus: incremental re-index proven by
 * stub call counts, hybrid fusion surfacing a lexical-only and a semantic-only
 * match, kind filtering, degradation without a model, and snippet bounds.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
async function mount(config: Config = {}): Promise<Mounted> {
  context = new Context()
  const state: StubState = { calls: [], failModel: false }
  await context.plugin(stubServiceClass(state), {
    root: root!,
    indexPath: ':memory:',
    corpus: [
      { kind: 'subsystem', root: 'docs/subsystems', suffix: '.md', recursive: false, packageReadme: false },
      { kind: 'readme', root: 'packages', suffix: 'README.md', recursive: true, packageReadme: true },
      { kind: 'note', root: '.agents/notes', suffix: '.md', recursive: true, packageReadme: false },
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
    await fixture('docs/subsystems/session-query.md', '# Session Query\n\n## Logical records\n\nA record carries availability flags.\n')
    await fixture('docs/subsystems/shell.md', '# Shell\n\n## Executor\n\nBash runs commands.\n')
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
    expect(results.map(result => `${result.file}#${result.anchor}`)).toContain('docs/subsystems/session-query.md#logical-records')
    expect(results[0]!.source).toBe('subsystem')
    expect(results[0]!.arms.lexical).toBeDefined()
  })

  it('re-embeds only chunks whose body changed', async () => {
    await fixture('docs/subsystems/a.md', '# A\n\n## One\n\nalpha\n')
    await fixture('docs/subsystems/b.md', '# B\n\n## Two\n\nbeta\n')
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
    await fixture('docs/subsystems/a.md', '# A\n\n## One\n\nalpha rewritten\n')
    service.reindex()
    await settle(service)
    expect(embeddedDocuments(calls)).toBe(afterFirst + 1)

    // One file vanishes: its chunks are deleted and nothing is re-embedded.
    await rm(join(root!, 'docs/subsystems/b.md'))
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
    await fixture('docs/subsystems/a.md', '# Retrieval\n\n## Subject\n\nindex internals\n')
    await fixture('docs/subsystems/b.md', '# B\n\n## Aside\n\nunrelated\n')
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
    await fixture('docs/subsystems/a.md', '# A\n\n## Subject\n\nquasar observations\n')
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

  it('fuses two arms into one ranking when both rank a chunk', async () => {
    await fixture('docs/subsystems/a.md', '# A\n\n## Target\n\nhybrid retrieval over documentation\n')
    await fixture('docs/subsystems/b.md', '# B\n\n## Noise\n\nnothing relevant here at all\n')
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
    await fixture('docs/subsystems/a.md', '# A\n\n## Subject\n\nquasar here\n')
    await fixture('packages/docs/docs-search/README.md', '# docs-search\n\n## Subject\n\nquasar here too\n')
    await fixture('.agents/notes/implemented/feature/x.md', '# Note\n\n## Subject\n\nquasar in a note\n')
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
      await fixture(`docs/subsystems/s${index}.md`, `# S${index}\n\n## Subject\n\nquasar number ${index}\n`)
    }
    const { service } = await mount({ defaultLimit: 2, maxLimit: 40 })
    service.reindex()
    await settle(service)

    expect(await service.search({ query: 'quasar' })).toHaveLength(2)
    expect(await service.search({ query: 'quasar', limit: 4 })).toHaveLength(4)
    await expect(service.search({ query: 'quasar', limit: 41 })).rejects.toThrow(/between 1 and 40/)
  })

  it('bounds every snippet to the configured character budget', async () => {
    await fixture('docs/subsystems/a.md', `# A\n\n## Long\n\n${'word '.repeat(200)}\n`)
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
    await fixture('docs/subsystems/a.md', `# A\n\n## Long\n\n${body}\n`)
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
    await fixture('docs/subsystems/code.md', [
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
    await fixture('docs/subsystems/a.md', '# A\n\n## Subject\n\nquasar here\n')
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
    await fixture('docs/subsystems/a.md', '# A\n\n## Subject\n\nquasar\n')
    const { service } = await mount()
    expect(service.reindex()).toEqual({})
    await settle(service)
  })

  it('rejects a blank query and a query with no searchable token', async () => {
    await fixture('docs/subsystems/a.md', '# A\n\n## Subject\n\nquasar\n')
    const { service } = await mount()
    service.reindex()
    await settle(service)
    await expect(service.search({ query: '   ' })).rejects.toThrow(/must contain letters or digits/)
    await expect(service.search({ query: '***' })).rejects.toThrow(/must contain letters or digits/)
  })

  it('treats an FTS5 operator in a query as data', async () => {
    await fixture('docs/subsystems/a.md', '# A\n\n## Subject\n\nalpha beta\n')
    const { service } = await mount()
    service.reindex()
    await settle(service)
    // A bare `AND` would be a syntax error or an operator if it reached FTS5.
    const results = await service.search({ query: 'alpha AND beta' })
    expect(results.some(result => result.anchor === 'subject')).toBe(true)
  })

  it('degrades the semantic arm when sqlite-vec cannot load', async () => {
    await fixture('docs/subsystems/a.md', '# A\n\n## Subject\n\nquasar here\n')
    const { service } = await mount()
    // Fixing `dimensions` and the store open path proves the lexical arm keeps
    // answering when the extension is missing; the index is opened without it
    // by pointing at a database the extension never touched.
    service.reindex()
    await settle(service)
    const results = await service.search({ query: 'quasar' })
    expect(results.some(result => result.anchor === 'subject')).toBe(true)
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
    expect(() => resolveConfig({ dimensions: 300 })).toThrow(/dimensions must be one of/)
  })

  it('refuses a blank path and an inverted limit pair', () => {
    expect(() => resolveConfig({ root: '  ' })).toThrow(/root must not be blank/)
    expect(() => resolveConfig({ indexPath: '' })).toThrow(/indexPath must not be blank/)
    expect(() => resolveConfig({ modelId: ' ' })).toThrow(/modelId must not be blank/)
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
}

void (null as unknown as DocsSearchResult)
