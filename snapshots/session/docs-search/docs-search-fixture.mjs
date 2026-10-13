/** Local lexical index over the scenario corpus; no embedding model is loaded. */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const baseRequire = createRequire(new URL('../../../packages/bundle/base/package.json', import.meta.url))
const provider = process.env.DSH_EXAMPLE_MODE === 'lib'
  ? pathToFileURL(baseRequire.resolve('@deepseek-ai/dsh-docs-search-local')).href
  : '@deepseek-ai/dsh-docs-search-local'
const { default: LocalDocsSearchService } = await import(provider)

export const name = 'docs-search-fixture'
export const inject = ['jobs']

class LexicalDocsSearch extends LocalDocsSearchService {
  async createEmbedder() {
    this.recordDegradation('embedding model omitted by the keyless lexical fixture')
    return undefined
  }
}

/** Build the real SQLite index before the headless session accepts its task. */
export async function apply(ctx) {
  ctx.jobs.attachController('docs-search-fixture')
  await ctx.plugin(LexicalDocsSearch, {
    root: process.cwd(),
    indexPath: ':memory:',
    corpus: [{ kind: 'guide', root: 'docs', suffix: '.md', recursive: false, packageReadme: false }],
  })
  await ctx.inject(['docsSearch'], async (searchCtx) => {
    const handle = searchCtx.docsSearch.reindex()
    if (handle.jobId === undefined) throw new Error('docs-search fixture requires a registered build')
    const outcome = await searchCtx.jobs.wait(handle.jobId, 10000)
    if (outcome.status !== 'completed') throw new Error(`docs-search fixture build ${outcome.status}: ${outcome.detail}`)
  })
}
