/**
 * Chunking behavior across every corpus kind, with anchor-resolution
 * assertions: for each chunk, locating the anchor inside the file must yield
 * the chunk's title. That is the contract a consumer depends on when it reads
 * `file` at `anchor` for full text.
 */

import { mkdir, mkdtemp, rm, writeFile, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { documentAnchors } from '../../../../scripts/verify-md-links.ts'
import { DocsIndexStore } from '../src/store.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  chunkMarkdown,
  defaultDocsCorpusRules,
  headingSlug,
  scanDocsCorpus,
  type DocsChunk,
} from '../src/chunker.ts'

let root: string | undefined

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-docs-chunker-'))
})

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Write one fixture file, creating its parent directories. */
async function fixture(path: string, contents: string): Promise<void> {
  const absolute = join(root!, path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, contents)
}

/**
 * Resolve a chunk's anchor back to a heading in its file and return the
 * heading text, which is what proves the anchor addresses the right section.
 */
async function titleAtAnchor(chunk: DocsChunk): Promise<string | undefined> {
  const source = await import('node:fs/promises').then(fs => fs.readFile(join(root!, chunk.file), 'utf8'))
  for (const line of source.split('\n')) {
    const match = /^(#{1,6})\s+(.*)$/u.exec(line)
    if (match !== null && headingSlug(match[2]!.trim()) === chunk.anchor) return match[2]!.trim().replaceAll('`', '')
  }
  return undefined
}

describe('docs corpus scanning', () => {
  it('chunks every corpus kind from one scan and keeps anchors resolvable', async () => {
    await fixture('packages/util/brand/README.md', [
      '# @deepseek-ai/dsh-docs-search',
      '',
      'Lead paragraph.',
      '',
      '## Summary',
      '',
      'Contract prose.',
      '',
      '## Known Limitations and Deferred Work',
      '',
      '- None yet.',
      '',
    ].join('\n'))
    await fixture('docs/config-catalog.md', [
      '# Configuration catalog',
      '',
      '## `@deepseek-ai/dsh-docs-search`',
      '',
      '| Field | Default |',
      '',
    ].join('\n'))
    await fixture('docs/subsystems/session-query.md', [
      '# Session Query',
      '',
      '## Logical records',
      '',
      'Record prose.',
      '',
    ].join('\n'))
    await fixture('docs/user/index.md', [
      '# User guide',
      '',
      '## Getting started',
      '',
      'Guide prose.',
      '',
    ].join('\n'))
    await fixture('.specs/tasks/local-hybrid-docs-search.spec.md', [
      '---',
      'id: TASK:docs/local-hybrid-docs-search',
      'summary: Search repository documentation locally.',
      '---',
      '',
      '# Local hybrid docs search',
      '',
      '## Acceptance',
      '',
      'Acceptance prose.',
      '',
    ].join('\n'))
    await fixture('docs/tool-catalog.md', [
      '# Tool catalog',
      '',
      '## `docs_search`',
      '',
      'Tool prose.',
      '',
    ].join('\n'))

    const chunks = await scanDocsCorpus({
      root: root!,
      rules: defaultDocsCorpusRules(),
      maxBodyChars: 8_000,
      maxCodeLines: 40,
    })

    // Three chunks per file: the H1 preamble carries the document lead, and
    // each `##` section carries one chunk.
    expect(chunks.map(chunk => chunk.kind).sort()).toEqual(
      ['catalog', 'catalog', 'catalog', 'catalog', 'guide', 'guide', 'readme', 'readme', 'readme', 'spec', 'spec', 'spec', 'subsystem', 'subsystem'],
    )
    for (const chunk of chunks) {
      const heading = await titleAtAnchor(chunk)
      if (chunk.anchor === '') continue
      expect(heading, `${chunk.file}#${chunk.anchor}`).toBeDefined()
      const expected = chunk.kind === 'readme'
        ? `@deepseek-ai/dsh-brand ${heading}`
        : heading
      expect(chunk.title).toBe(expected)
    }
  })

  it('keys a generated catalog by its per-package section id', async () => {
    await fixture('docs/config-catalog.md', [
      '# Configuration catalog',
      '',
      '## `@deepseek-ai/dsh-docs-search-local`',
      '',
      'local config',
      '',
      '## `@deepseek-ai/dsh-docs-search`',
      '',
      'definition config',
      '',
      '## Not a package',
      '',
      'other',
      '',
    ].join('\n'))
    const chunks = await scanDocsCorpus({
      root: root!,
      rules: defaultDocsCorpusRules(),
      maxBodyChars: 8_000,
      maxCodeLines: 40,
    })
    const catalog = chunks.filter(chunk => chunk.kind === 'catalog')
    expect(catalog.map(chunk => chunk.anchor)).toEqual([
      'configuration-catalog',
      'deepseek-aidsh-docs-search-local',
      'deepseek-aidsh-docs-search',
      'not-a-package',
    ])
    expect(catalog.map(chunk => chunk.title)).toEqual([
      'Configuration catalog',
      '@deepseek-ai/dsh-docs-search-local',
      '@deepseek-ai/dsh-docs-search',
      'Not a package',
    ])
  })

  it('carries a task specification summary as its own chunk', async () => {
    await fixture('.specs/tasks/x.spec.md', [
      '---',
      'id: TASK:docs/x',
      'summary: A durable intent line that spans',
      '  two physical lines.',
      '---',
      '',
      '# Title',
      '',
      '## Acceptance',
      '',
      'Body.',
      '',
    ].join('\n'))
    const chunks = await scanDocsCorpus({
      root: root!,
      rules: defaultDocsCorpusRules(),
      maxBodyChars: 8_000,
      maxCodeLines: 40,
    })
    const summary = chunks.find(chunk => chunk.anchor === '')
    expect(summary?.title).toBe('Summary')
    expect(summary?.body).toBe('A durable intent line that spans two physical lines.')
  })

  it('skips a corpus root that does not exist', async () => {
    await fixture('.specs/tasks/y.spec.md', '# Y\n\n## Acceptance\n\nBody.\n')
    const chunks = await scanDocsCorpus({
      root: root!,
      rules: defaultDocsCorpusRules(),
      maxBodyChars: 8_000,
      maxCodeLines: 40,
    })
    expect(chunks).toHaveLength(2)
  })

  it('hashes bodies so an unchanged chunk is recognizable', () => {
    const context = { kind: 'subsystem' as const, file: 'fixture.md', titlePrefix: '', maxBodyChars: 1_000, maxCodeLines: 40 }
    const first = chunkMarkdown('# T\n\n## A\n\nbody\n', context)
    const second = chunkMarkdown('# T\n\n## A\n\nbody\n', context)
    const third = chunkMarkdown('# T\n\n## A\n\nchanged\n', context)
    expect(first.find(chunk => chunk.anchor === 'a')?.hash).toBe(second.find(chunk => chunk.anchor === 'a')?.hash)
    expect(first.find(chunk => chunk.anchor === 'a')?.hash).not.toBe(third.find(chunk => chunk.anchor === 'a')?.hash)
  })

  it('drops a fenced code block longer than the configured bound but keeps it locatable', () => {
    const long = Array.from({ length: 41 }, (_, index) => `line ${index}`)
    const chunks = chunkMarkdown([
      '# T',
      '',
      '## Big',
      '',
      'Intro.',
      '',
      '```ts',
      ...long,
      '```',
      '',
      'Outro.',
      '',
    ].join('\n'), {
      kind: 'subsystem',
      file: 'fixture.md',
      titlePrefix: '',
      maxBodyChars: 8_000,
      maxCodeLines: 40,
    })
    const section = chunks.find(chunk => chunk.anchor === 'big')
    expect(section?.body).toContain('Intro.')
    expect(section?.body).toContain('Outro.')
    expect(section?.body).toContain('[41 code lines omitted]')
    expect(section?.body).not.toContain('line 40')
  })

  it('keeps a fenced code block at or below the configured bound', () => {
    const short = Array.from({ length: 40 }, (_, index) => `line ${index}`)
    const chunks = chunkMarkdown([
      '# T',
      '',
      '## Small',
      '',
      '```ts',
      ...short,
      '```',
      '',
    ].join('\n'), {
      kind: 'subsystem',
      file: 'fixture.md',
      titlePrefix: '',
      maxBodyChars: 8_000,
      maxCodeLines: 40,
    })
    expect(chunks.find(chunk => chunk.anchor === 'small')?.body).toContain('line 39')
  })

  it('bounds an over-long body to the configured character budget', () => {
    const chunks = chunkMarkdown(`# T\n\n## Long\n\n${'x'.repeat(500)}\n`, {
      kind: 'subsystem',
      file: 'fixture.md',
      titlePrefix: '',
      maxBodyChars: 100,
      maxCodeLines: 40,
    })
    const section = chunks.find(chunk => chunk.anchor === 'long')
    expect(section?.body).toHaveLength(101)
    expect(section?.body.endsWith('…')).toBe(true)
  })

  it('does not treat a heading inside a fenced block as a section boundary', () => {
    const chunks = chunkMarkdown([
      '# T',
      '',
      '## Real',
      '',
      '```md',
      '## Not a section',
      '```',
      '',
      'Tail.',
      '',
    ].join('\n'), {
      kind: 'subsystem',
      file: 'fixture.md',
      titlePrefix: '',
      maxBodyChars: 8_000,
      maxCodeLines: 40,
    })
    expect(chunks.map(chunk => chunk.anchor)).toEqual(['t', 'real'])
    expect(chunks.find(chunk => chunk.anchor === 'real')?.body).toContain('## Not a section')
  })
})

describe('heading slugs', () => {
  it('lowercases, drops punctuation, and hyphenates spaces', () => {
    expect(headingSlug('Logical records')).toBe('logical-records')
    expect(headingSlug('`ctx.sessionQuery` — `SessionQueryEngine`')).toBe('ctxsessionquery--sessionqueryengine')
    expect(headingSlug('###')).toBe('')
  })
})

const chunkContext = { kind: 'subsystem' as const, file: 'doc.md', titlePrefix: '', maxBodyChars: 8000, maxCodeLines: 2 }

it('uses occupied GitHub fragments for repeated, linked, and Setext headings', () => {
  const source = '# Repeat\n\none\n\n# Repeat-1\n\ntwo\n\n# Repeat\n\nthree\n\n[Link](./target.md)\n---\n\nfour\n'
  const chunks = chunkMarkdown(source, chunkContext)
  expect(chunks.map(chunk => chunk.anchor)).toEqual(['repeat', 'repeat-1', 'repeat-2', 'link'])
  expect(chunks.map(chunk => chunk.body)).toEqual(['one', 'two', 'three', 'four'])
})

it('hashes title and corpus kind as well as body content', () => {
  const first = chunkMarkdown('# title\nbody', chunkContext)[0]!
  expect(chunkMarkdown('# Title\nbody', chunkContext)[0]!.hash).not.toBe(first.hash)
  expect(chunkMarkdown('# title\nbody', { ...chunkContext, kind: 'guide' })[0]!.hash).not.toBe(first.hash)
})

it.each([
  '---\nkind: guide\n---\n# Title\nbody',
  '---\nsummary:\nkind: guide\n---\n# Title\nbody',
  '---\nsummary: absent closing delimiter\n# Title\nbody',
  '---\nsummary: intro\nkind: guide\n---\npreamble\n# Title\nbody',
  'body without headings',
  '# Title\n~~~ts\nfirst\n```\nthird\n',
])('indexes frontmatter and incomplete Markdown without inventing fragments', (source) => {
  const anchors = documentAnchors(source)
  const chunks = chunkMarkdown(source, chunkContext)
  expect(chunks.length).toBeGreaterThan(0)
  for (const chunk of chunks) expect(chunk.anchor === '' || anchors.has(chunk.anchor)).toBe(true)
})

it('ignores symlinks, suffix lookalikes, and nonrecursive descendants', async () => {
  await fixture('corpus/README.md', '# Root\nbody')
  await fixture('corpus/not-README.md', '# Lookalike')
  await fixture('corpus/nested/README.md', '# Nested')
  await symlink(join(root!, 'corpus/README.md'), join(root!, 'corpus/link.md'))
  const chunks = await scanDocsCorpus({ root: root!, rules: [{ kind: 'readme', root: 'corpus', suffix: 'README.md', recursive: false, packageReadme: true }], maxBodyChars: 8000, maxCodeLines: 40 })
  expect(chunks).toHaveLength(1)
  expect(chunks[0]!.title).toBe('corpus/README.md Root')
})

it('propagates a non-directory corpus root', async () => {
  await fixture('file.md', '# File')
  await expect(scanDocsCorpus({ root: root!, rules: [{ kind: 'guide', root: 'file.md', suffix: '.md', recursive: false, packageReadme: false }], maxBodyChars: 8000, maxCodeLines: 40 })).rejects.toMatchObject({ code: 'ENOTDIR' })
})

it('indexes the real default corpus with unique keys and resolvable heading fragments', async () => {
  const repository = resolve(import.meta.dirname, '../../../..')
  const chunks = await scanDocsCorpus({ root: repository, rules: defaultDocsCorpusRules(), maxBodyChars: 8000, maxCodeLines: 40 })
  const keys = chunks.map(chunk => `${chunk.file}#${chunk.anchor}`)
  expect(new Set(keys).size).toBe(keys.length)
  const anchors = new Map<string, Set<string>>()
  for (const chunk of chunks) {
    if (chunk.anchor === '') continue
    let fileAnchors = anchors.get(chunk.file)
    if (fileAnchors === undefined) {
      fileAnchors = documentAnchors(await readFile(join(repository, chunk.file), 'utf8'))
      anchors.set(chunk.file, fileAnchors)
    }
    expect(fileAnchors.has(chunk.anchor), `${chunk.file}#${chunk.anchor}`).toBe(true)
  }
  const store = await DocsIndexStore.open(':memory:')
  try {
    expect(store.reconcile(chunks).changed).toBe(chunks.length)
    expect(store.reconcile(chunks).changed).toBe(0)
    expect(store.searchLexical('"coordination"', 5, [])).not.toHaveLength(0)
  } finally { store.close() }
}, 120_000)
