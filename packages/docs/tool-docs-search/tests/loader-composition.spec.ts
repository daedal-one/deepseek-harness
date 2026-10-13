// Product-visible plugin policy: the tool is exercised through a real Loader composition —
// a cordis.yml boots the tool registry, a test-only docsSearch provider, and this plugin,
// and every call runs through `ctx.tools.execute` exactly as the loop would drive it. Only
// the service is a stand-in (the seam's provider packages ship separately); the registry,
// the schema validation, and the tool are the shipping code.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import DocsSearcher from '@deepseek-ai/dsh-docs-search'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { DocsSearchRequest, DocsSearchReindexHandle, DocsSearchResult, DocsSearchStatus } from '@deepseek-ai/dsh-docs-search'
import * as yaml from 'js-yaml'
import * as tool from '../src/index.ts'

const testToolSignal = new AbortController().signal

/** Every StubDocsSearch created by this file, for reaching recorded calls per test. */
const instances: StubDocsSearch[] = []

/** Behavior knobs and canned results for the test-only docsSearch provider. */
interface StubConfig {
  /** Hits every search call returns, in service rank order. */
  readonly hits?: DocsSearchResult[]
  /** Whether `status()` reports a build in progress. */
  readonly building?: boolean
}

/**
 * The stand-in `ctx.docsSearch` provider: subclasses the real seam base class, records every
 * search request verbatim, and answers from the canned fixture, so the tool's passthrough
 * and its rendering are observable through a real composition.
 */
class StubDocsSearch extends DocsSearcher {
  readonly calls: DocsSearchRequest[] = []
  private readonly hits: DocsSearchResult[]
  private readonly building: boolean

  constructor(ctx: Context, config: StubConfig = {}) {
    super(ctx)
    this.hits = config.hits ?? []
    this.building = config.building ?? false
    instances.push(this)
  }

  override async search(request: DocsSearchRequest): Promise<DocsSearchResult[]> {
    this.calls.push(request)
    return this.hits
  }

  override status(): DocsSearchStatus {
    return { chunks: 7, indexed: 7, modelReady: true, building: this.building }
  }

  override reindex(): DocsSearchReindexHandle {
    return {}
  }
}

/** One hit with every contract field populated, overridable per fixture. */
function hit(over: Partial<DocsSearchResult> = {}): DocsSearchResult {
  return {
    source: 'readme',
    file: 'README.md',
    anchor: 'setup',
    title: 'Setup',
    snippet: 'Install pnpm dependencies before building.',
    score: 0.5,
    arms: { lexical: 0.5 },
    ...over,
  }
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  instances.length = 0
})

/**
 * Boot a cordis.yml carrying the stub provider and the given tool config.
 * @param options - stub behavior and the tool's `config:` block.
 * @param options.stub - fixture for the test-only docsSearch provider.
 * @param options.toolConfig - the tool row's config object.
 * @param options.withStub - whether the stub row is present at all.
 * @returns the booted context.
 */
async function boot(options: { stub?: StubConfig; toolConfig?: Record<string, unknown>; withStub?: boolean } = {}): Promise<Context> {
  const { stub = {}, toolConfig, withStub = true } = options
  root = await mkdtemp(join(tmpdir(), 'dsh-docs-search-loader-'))
  const configPath = join(root, 'cordis.yml')
  const rows: unknown[] = [
    { name: '@deepseek-ai/dsh-system-prompt' },
    { name: '@deepseek-ai/dsh-tools' },
    ...(withStub ? [{ name: 'test/docs-search-stub', config: stub }] : []),
    { name: '@deepseek-ai/dsh-tool-docs-search', ...(toolConfig !== undefined ? { config: toolConfig } : {}) },
  ]
  await writeFile(configPath, yaml.dump(rows))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['test/docs-search-stub', StubDocsSearch],
    ['@deepseek-ai/dsh-tool-docs-search', tool],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

let callCounter = 0

/** Drive one docs_search call through the real registry pipeline. */
function callDocsSearch(ctx: Context, args: unknown) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`call-${++callCounter}`),
    name: 'docs_search',
    arguments: args,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('tool-docs-search real Loader composition through cordis.yml', () => {
  it('registers docs_search only when a docsSearch provider is mounted', async () => {
    const ctx = await boot()
    const schema = ctx.tools.schemas().find(s => s.name === 'docs_search')
    expect(schema).toBeDefined()
    const props = (schema!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props)).toEqual(['query', 'kind', 'limit'])
    expect((schema!.parameters as { required?: string[] }).required).toEqual(['query'])
    expect(props.query).toMatchObject({ type: 'string' })
    expect(props.kind).toMatchObject({ type: 'string', enum: ['all', 'readme', 'catalog', 'subsystem', 'note', 'spec', 'guide'] })
    expect(props.limit).toMatchObject({ type: 'integer' })
  })

  it('renders the bounded markdown list from the service hits', async () => {
    const ctx = await boot({
      stub: { hits: [
        hit(),
        hit({
          source: 'note',
          file: '.agents/notes/implemented/feature/x.md',
          anchor: 'decision',
          title: 'Decision',
          snippet: 'The tool refuses to load without the service.',
          score: 0.25,
          arms: { semantic: 0.25 },
        }),
      ] },
      toolConfig: { resultLimitCap: 50, snippetChars: 200 },
    })
    const result = await callDocsSearch(ctx, { query: 'loader inject' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected docs_search success')
    expect(text(result)).toBe([
      '- Setup — README.md#setup (readme, score 0.50)',
      '  Install pnpm dependencies before building.',
      '- Decision — .agents/notes/implemented/feature/x.md#decision (note, score 0.25)',
      '  The tool refuses to load without the service.',
      'Read the file at the anchor for the full text.',
    ].join('\n'))
  })

  it('bounds the canonical value to the requested limit and the configured snippet budget', async () => {
    const ctx = await boot({
      stub: { hits: [
        hit(),
        hit({ source: 'note', file: '.agents/notes/x.md', anchor: 'decision', title: 'Decision', snippet: 'The tool refuses to load without the service.', score: 0.25, arms: {} }),
        hit({ source: 'guide', title: 'Steps', snippet: 'third hit', score: 0.1, arms: {} }),
      ] },
      toolConfig: { resultLimitCap: 2, snippetChars: 12 },
    })
    const result = await callDocsSearch(ctx, { query: 'q', limit: 2 })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected docs_search success')
    expect(result.value).toEqual({
      hits: [
        { source: 'readme', file: 'README.md', anchor: 'setup', title: 'Setup', snippet: 'Install p...', score: 0.5, arms: { lexical: 0.5 } },
        { source: 'note', file: '.agents/notes/x.md', anchor: 'decision', title: 'Decision', snippet: 'The tool ...', score: 0.25, arms: {} },
      ],
      building: false,
    })
    expect(text(result)).toBe([
      '- Setup — README.md#setup (readme, score 0.50)',
      '  Install p...',
      '- Decision — .agents/notes/x.md#decision (note, score 0.25)',
      '  The tool ...',
      'Read the file at the anchor for the full text.',
    ].join('\n'))
  })

  it('says results are lexical-only while the index is building', async () => {
    const ctx = await boot({ stub: { hits: [hit()], building: true } })
    const result = await callDocsSearch(ctx, { query: 'q' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected docs_search success')
    expect(result.value.building).toBe(true)
    expect(text(result).startsWith('The documentation index is still building; these results are lexical-only meanwhile.\n- Setup')).toBe(true)
  })

  it('forwards the query verbatim with exactly the optional fields the model sent', async () => {
    const ctx = await boot()
    await callDocsSearch(ctx, { query: 'kv cache', kind: 'note', limit: 3 })
    const request = instances[0]!.calls[0]!
    expect(request).toEqual({ query: 'kv cache', kind: 'note', limit: 3 })
    expect(Object.keys(request)).toEqual(['query', 'kind', 'limit'])

    await callDocsSearch(ctx, { query: 'second' })
    expect(instances[0]!.calls[1]).toEqual({ query: 'second' })
    expect(Object.keys(instances[0]!.calls[1])).toEqual(['query'])
  })

  it('rejects an explicit limit above the deployment cap through the executor', async () => {
    const ctx = await boot({ toolConfig: { resultLimitCap: 2 } })
    const result = await callDocsSearch(ctx, { query: 'q', limit: 3 })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('invalid limit: exceeds the configured result limit cap (2)')
    expect(instances[0]!.calls).toHaveLength(0)
  })

  it.each([
    { label: 'an empty query', args: { query: '' }, fragment: 'invalid query: must be a non-empty string' },
    { label: 'a whitespace-only query', args: { query: '   ' }, fragment: 'invalid query: must be a non-empty string' },
    { label: 'an over-long query', args: { query: 'x'.repeat(513) }, fragment: 'invalid query: must be at most 512 characters' },
    { label: 'limit 0', args: { query: 'q', limit: 0 }, fragment: 'invalid limit: must be between 1 and 50' },
    { label: 'limit 51', args: { query: 'q', limit: 51 }, fragment: 'invalid limit: must be between 1 and 50' },
  ])('rejects $label before the service is called', async ({ args, fragment }) => {
    const ctx = await boot()
    const result = await callDocsSearch(ctx, args)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain(fragment)
    expect(instances[0]!.calls).toHaveLength(0)
  })

  it.each([
    { label: 'an unknown kind', args: { query: 'q', kind: 'changelog' } },
    { label: 'a non-integer limit', args: { query: 'q', limit: 1.5 } },
  ])('rejects $label at the registry schema boundary', async ({ args }) => {
    const ctx = await boot()
    const result = await callDocsSearch(ctx, args)
    expect(result.isError).toBe(true)
    expect(instances[0]!.calls).toHaveLength(0)
  })

  it('renders the no-match line without the final line when the service returns nothing', async () => {
    const ctx = await boot({ stub: { hits: [] } })
    const result = await callDocsSearch(ctx, { query: 'q' })
    expect(result.isError).toBe(false)
    expect(text(result)).toBe('No documentation matches the query.')
  })

  it('presents the call with the query as the raw input', async () => {
    const ctx = await boot()
    const def = ctx.tools.get('docs_search')!
    expect(def.presentCall?.({ query: 'kv cache' })).toEqual({
      card: 'generic',
      title: 'Docs search: kv cache',
      kind: 'search',
      rawInput: 'kv cache',
    })
  })
})

describe('tool-docs-search configuration and composition refusal', () => {
  it.each([
    { label: 'resultLimitCap: 0', configLines: { resultLimitCap: 0 }, failure: 'tool-docs-search: resultLimitCap must be an integer between 1 and 50' },
    { label: 'resultLimitCap: 51', configLines: { resultLimitCap: 51 }, failure: 'tool-docs-search: resultLimitCap must be an integer between 1 and 50' },
    { label: 'resultLimitCap: 1.5', configLines: { resultLimitCap: 1.5 }, failure: 'tool-docs-search: resultLimitCap must be an integer between 1 and 50' },
    { label: 'snippetChars: 0', configLines: { snippetChars: 0 }, failure: 'tool-docs-search: snippetChars must be a positive integer' },
    { label: 'snippetChars: 1.5', configLines: { snippetChars: 1.5 }, failure: 'tool-docs-search: snippetChars must be a positive integer' },
    { label: 'resultLimitCap is not a number', configLines: { resultLimitCap: 'high' }, failure: '$.resultLimitCap expected number' },
  ])('fails loading when the config sets $label', async ({ configLines, failure }) => {
    // Both budgets are self-contained deployment choices, so misconfiguration
    // fails at load: the entry's apply rejects and boot never reaches a
    // running tool.
    await expect(boot({ toolConfig: configLines })).rejects.toThrow(failure)
  }, 30_000)

  it('refuses to mount the tool when no docsSearch provider exists in the composition', async () => {
    const ctx = await boot({ withStub: false })
    // The declared `docsSearch` injection keeps the plugin fiber pending, so
    // the `docs_search` tool never registers instead of failing per call.
    expect(ctx.tools.schemas().some(s => s.name === 'docs_search')).toBe(false)
  }, 30_000)
})

describe('tool-docs-search registration lifecycle', () => {
  it('unregisters the tool when its contributing fiber is disposed (HMR-safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(StubDocsSearch, { hits: [hit()] })
    const fiber = await ctx.plugin(tool, {})
    expect(ctx.tools.schemas().some(s => s.name === 'docs_search')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(s => s.name === 'docs_search')).toBe(false)
  })

  it('has the namespace-plugin export shape (no stray default) so the Loader keeps name/inject/apply', () => {
    // A default export would make Loader unwrap only apply and drop `inject`.
    expect('default' in tool).toBe(false)
    expect(tool.name).toBe('tool-docs-search')
    expect(tool.inject).toEqual(['tools', 'docsSearch'])

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(tool) as Record<string, unknown>
    expect(unwrapped).toBe(tool)
    expect(unwrapped.name).toBe('tool-docs-search')
    expect(unwrapped.inject).toEqual(['tools', 'docsSearch'])
    expect(typeof unwrapped.apply).toBe('function')
  })
})
