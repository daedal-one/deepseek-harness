/**
 * Real-composition proof: a test-only `cordis.yml` loaded by the vendored
 * Loader boots the docs-search provider through its published entry, indexes a
 * temporary corpus, and answers a search over the loaded service. The stubbed
 * embedder is the only substituted input; the Loader, the Config boundary, the
 * SQLite store, and FTS5 are all real.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { DocsEmbedder } from '../src/embedder.ts'
import { LocalDocsSearchService } from '../src/index.ts'
import { stubEmbedder } from './stub-embedder.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** The Loader-imported plugin, with the stub embedder standing in for weights. */
class LoaderDocsSearch extends LocalDocsSearchService {
  protected override async createEmbedder(): Promise<DocsEmbedder | undefined> {
    const embedder = stubEmbedder(this.config.dimensions)
    this.useEmbedder(embedder)
    return embedder
  }
}

describe('docs-search real Loader composition through cordis.yml', () => {
  it('indexes a corpus and answers from the loaded service', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-docs-loader-'))
    await mkdir(join(root, 'docs/subsystems'), { recursive: true })
    await mkdir(join(root, 'packages/docs/docs-search'), { recursive: true })
    await writeFile(
      join(root, 'docs/subsystems/session-query.md'),
      '# Session Query\n\n## Logical records\n\nA record carries availability flags.\n',
    )
    await writeFile(
      join(root, 'packages/docs/docs-search/README.md'),
      '# docs-search\n\n## Summary\n\nThe definition owns the seam vocabulary.\n',
    )

    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-docs-search-local'",
      '  config:',
      `    root: ${JSON.stringify(root)}`,
      `    indexPath: ${JSON.stringify(join(root, 'index.sqlite'))}`,
      '    dimensions: 128',
      '    defaultLimit: 5',
      '    corpus:',
      '      - kind: subsystem',
      '        root: docs/subsystems',
      "        suffix: '.md'",
      '        recursive: false',
      '        packageReadme: false',
      '      - kind: readme',
      '        root: packages',
      "        suffix: 'README.md'",
      '        recursive: true',
      '        packageReadme: true',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = `${pathToFileURL(root).href}/`
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier !== '@deepseek-ai/dsh-docs-search-local') {
          throw new Error(`unexpected Loader import: ${specifier}`)
        }
        return LoaderDocsSearch
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    // The Config boundary applied the composition's values to the live service.
    const service = context.docsSearch
    expect(service).toBeInstanceOf(LoaderDocsSearch)
    expect(service).toBeInstanceOf(LocalDocsSearchService)

    service.reindex()
    for (let attempt = 0; attempt < 2_000 && service.status().building; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    const status = service.status()
    expect(status.building).toBe(false)
    expect(status.chunks).toBe(4)
    expect(status.indexed).toBe(2)
    expect(status.modelReady).toBe(true)
    expect(status.lastError).toBeUndefined()

    const results = await service.search({ query: 'availability flags' })
    expect(results[0]).toMatchObject({
      source: 'subsystem',
      file: 'docs/subsystems/session-query.md',
      anchor: 'logical-records',
    })
    expect(results[0]!.snippet).toContain('availability flags')

    // The composition's `defaultLimit` governs an unqualified request.
    expect(await service.search({ query: 'the' })).toHaveLength(4)

    // The package-README rule prefixes the section title with the package name.
    const readme = await service.search({ query: 'seam vocabulary', kind: 'readme' })
    expect(readme[0]?.title).toBe('@deepseek-ai/dsh-docs-search Summary')
  }, 30_000)
})
