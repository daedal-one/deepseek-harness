/** Tests for the single-locale documentation website projection adapter. */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { docsPages, landingLink, routeLink, sectionSpec, type DocsPage } from '../website/docs.ts'
import {
  addProjectionFrontmatter, projectedPageContent, publishableImage, rewriteMarkdown, withoutRepositoryChrome,
} from './project-doc-site.ts'

const roots: string[] = []
const repositoryRoot = resolve(import.meta.dirname, '..')

function unexpectedWebsiteMarkdown(files: readonly string[]): string[] {
  return files.filter(file => file.endsWith('.md') && file !== 'website/AGENTS.md').sort()
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function page(source: string, route: string): DocsPage {
  return {
    contentLocale: 'en-US', source, route, label: route, sidebar: 'reference', section: 'Test', order: 1,
  }
}

function fixture(): { root: string; pages: DocsPage[] } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-doc-site-'))
  roots.push(root)
  mkdirSync(join(root, 'docs'), { recursive: true })
  mkdirSync(join(root, 'docs/guide'), { recursive: true })
  mkdirSync(join(root, 'packages'), { recursive: true })
  writeFileSync(join(root, 'docs/a.md'), '# A\n')
  writeFileSync(join(root, 'docs/b.md'), '# B\n')
  writeFileSync(join(root, 'docs/x(y).md'), '# Parentheses\n')
  writeFileSync(join(root, 'packages/tool.ts'), 'one\ntwo\n')
  writeFileSync(join(root, 'packages/logo.svg'), '<svg/>\n')
  return {
    root,
    pages: [
      page('docs/a.md', 'guide/a.md'),
      page('docs/b.md', 'reference/b.md'),
    ],
  }
}

describe('website source layout', () => {
  it('rejects Markdown outside the subtree instructions', () => {
    expect(unexpectedWebsiteMarkdown([
      'website/AGENTS.md',
      'website/docs.ts',
      'website/guide/index.md',
    ])).toEqual(['website/guide/index.md'])
  })

  it('contains no tracked or unignored documentation copies', () => {
    const files = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'website'],
      { cwd: repositoryRoot, encoding: 'utf8' },
    ).split('\n').filter(file => file !== '' && existsSync(resolve(repositoryRoot, file)))

    expect(
      unexpectedWebsiteMarkdown(files),
      'Keep canonical Markdown under docs/ and publish it through website/docs.ts.',
    ).toEqual([])
  })
})

describe('publishableImage', () => {
  it('accepts a regular file inside the repository', () => {
    const { root } = fixture()
    const real = realpathSync(join(root, 'packages/logo.svg'))
    expect(publishableImage(join(root, 'packages/logo.svg'), realpathSync(root))).toBe(real)
  })

  it('refuses a target whose real path escapes the repository', () => {
    // Publication copies the bytes onto the site, so a reference reaching a
    // build-machine file must not be treated as an image the repository owns.
    const { root } = fixture()
    const outside = mkdtempSync(join(tmpdir(), 'dsh-doc-site-outside-'))
    roots.push(outside)
    writeFileSync(join(outside, 'secret.png'), 'not really a png\n')
    symlinkSync(join(outside, 'secret.png'), join(root, 'packages/linked.png'))

    expect(publishableImage(join(root, 'packages/linked.png'), realpathSync(root))).toBeUndefined()
    expect(publishableImage(join(outside, 'secret.png'), realpathSync(root))).toBeUndefined()
  })

  it('refuses a directory', () => {
    const { root } = fixture()
    expect(publishableImage(join(root, 'packages'), realpathSync(root))).toBeUndefined()
  })
})

describe('rewriteMarkdown', () => {
  it('maps published pages and pins unpublished source links', () => {
    const { root, pages } = fixture()
    const source = '[B](b.md#part) [source](../packages/tool.ts:2) [web](https://example.com)\n'
    expect(rewriteMarkdown(source, {
      sourcePath: 'docs/a.md',
      route: 'guide/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
    })).toBe(
      '[B](../reference/b.md#part) '
      + '[source](https://github.com/deepseek-ai/deepseek-harness/blob/abc123/packages/tool.ts#L2) '
      + '[web](https://example.com)\n',
    )
  })

  it('uses raw GitHub content for unpublished images when nothing places them', () => {
    const { root, pages } = fixture()
    expect(rewriteMarkdown('![logo](../packages/logo.svg)\n', {
      sourcePath: 'docs/a.md',
      route: 'guide/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
    })).toBe('![logo](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/abc123/packages/logo.svg)\n')
  })

  it('hands an image to the placer and uses the URL it returns', () => {
    const { root, pages } = fixture()
    const placed: string[] = []
    expect(rewriteMarkdown('![logo](../packages/logo.svg)\n', {
      sourcePath: 'docs/a.md',
      route: 'guide/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
      placeImage: (absPath) => {
        const name = basename(absPath)
        placed.push(name)
        return `./${name}`
      },
    })).toBe('![logo](./logo.svg)\n')
    expect(placed).toEqual(['logo.svg'])
  })

  it('keeps a placed image\u2019s query or fragment', () => {
    const { root, pages } = fixture()
    expect(rewriteMarkdown('![logo](../packages/logo.svg#view)\n', {
      sourcePath: 'docs/a.md',
      route: 'guide/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
      placeImage: absPath => `./${basename(absPath)}`,
    })).toBe('![logo](./logo.svg#view)\n')
  })

  it('leaves a published page link to the route even when a placer exists', () => {
    const { root, pages } = fixture()
    expect(rewriteMarkdown('[B](b.md)\n', {
      sourcePath: 'docs/a.md',
      route: 'guide/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
      placeImage: () => { throw new Error('a page link must not be placed as an asset') },
    })).toBe('[B](../reference/b.md)\n')
  })

  it('does not rewrite Markdown-looking text inside code fences', () => {
    const { root, pages } = fixture()
    const source = '```md\n[B](b.md)\n```\n'
    expect(rewriteMarkdown(source, {
      sourcePath: 'docs/a.md',
      route: 'guide/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
    })).toBe(source)
  })

  it('replaces the destination token without changing repeated titles or escapes', () => {
    const { root, pages } = fixture()
    const source = '[title](b.md "b.md") [escaped](x\\(y\\).md)\n'
    expect(rewriteMarkdown(source, {
      sourcePath: 'docs/a.md',
      route: 'guide/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
    })).toBe(
      '[title](../reference/b.md "b.md") '
      + '[escaped](https://github.com/deepseek-ai/deepseek-harness/blob/abc123/docs/x(y).md)\n',
    )
  })

  it('fails loud when a relative target is missing', () => {
    const { root, pages } = fixture()
    expect(() => rewriteMarkdown('[missing](missing.md)\n', {
      sourcePath: 'docs/a.md',
      route: 'guide/a.md',
      pages,
      repoRoot: root,
      repositoryRef: 'abc123',
    })).toThrow('links to missing path "missing.md"')
  })
})

describe('docsPages single-locale routes', () => {
  it('publishes every route once with an English source', () => {
    const byRoute = new Map<string, DocsPage>()
    for (const page of docsPages) {
      const existing = byRoute.get(page.route)
      expect(existing, page.route).toBeUndefined()
      byRoute.set(page.route, page)
    }
    expect(byRoute.size).toBe(docsPages.length)
    expect(docsPages.length).toBeGreaterThan(0)
    for (const published of byRoute.values()) {
      expect(published.contentLocale).toBe('en-US')
      expect(published.source).not.toMatch(/\.zh\.md$/)
      expect(existsSync(resolve(repositoryRoot, published.source))).toBe(true)
    }
  })

  it('redirects the home route to the quick-start page', () => {
    const homes = docsPages.filter(item => item.sidebar === null)
    expect(homes.map(item => item.route)).toEqual(['index.md'])
    const home = homes[0]
    if (home === undefined) throw new Error('manifest publishes no home page.')
    const source = readFileSync(resolve(repositoryRoot, home.source), 'utf8')
    const projected = projectedPageContent(source, home)
    expect(projected).toContain('layout: false')
    expect(projected).toContain('http-equiv: refresh')
    expect(projected).toContain('content: 0; url=./guide/quickstart')
    expect(projected).not.toContain('# DeepSeek Harness')
  })

  it('lands every navigation item on a page the manifest publishes', () => {
    const collections = ['guide', 'develop', 'reference'] as const
    const published = new Set(docsPages.map(item => routeLink(item.route)))
    for (const collection of collections) {
      const first = docsPages.filter(item => item.sidebar === collection)[0]
      expect(first, `${collection} / ${landingLink(collection)}`).toBeDefined()
      expect(published, collection).toContain(landingLink(collection))
    }
  })

  it('gives each page its own position within a section', () => {
    const taken = new Map<string, string>()
    const collisions: string[] = []
    for (const item of docsPages) {
      const slot = `${String(item.sidebar)}/${item.section}#${item.order}`
      const holder = taken.get(slot)
      if (holder === undefined) taken.set(slot, item.label)
      else collisions.push(`${slot}: ${holder} / ${item.label}`)
    }
    expect(collisions).toEqual([])
  })
})

describe('sidebar ordering', () => {
  it('places every section a sidebar collection owns', () => {
    for (const item of docsPages) {
      if (item.sidebar === null) continue
      expect(() => sectionSpec(item.section), item.route).not.toThrow()
    }
  })

  it('refuses a section with no declared placement', () => {
    expect(() => sectionSpec('unplaced-section'))
      .toThrow('Sidebar section "unplaced-section" has no placement.')
  })

  it('collapses the subsystem groups and leaves the smaller ones open', () => {
    expect(sectionSpec('Core and scopes').collapsed).toBe(true)
    expect(sectionSpec('Execution and tools').collapsed).toBe(true)
    expect(sectionSpec('Concepts').collapsed).toBeUndefined()
  })
})

describe('addProjectionFrontmatter', () => {
  it('adds frontmatter to an ordinary Markdown page', () => {
    expect(addProjectionFrontmatter('# Guide\n', { source: 'docs/guide.md' })).toBe(
      '---\neditSource: "docs/guide.md"\n---\n\n# Guide\n',
    )
  })

  it('extends existing VitePress frontmatter', () => {
    expect(addProjectionFrontmatter('---\nlayout: home\n---\n', { source: 'docs/index.md' })).toBe(
      '---\neditSource: "docs/index.md"\nlayout: home\n---\n',
    )
  })

  it('adds the page-specific outline depth from the publication manifest', () => {
    expect(addProjectionFrontmatter('# Catalog\n', {
      source: 'docs/catalog.md',
      outline: [2, 4],
    })).toBe(
      '---\neditSource: "docs/catalog.md"\noutline: [2,4]\n---\n\n# Catalog\n',
    )
  })
})

describe('projectedPageContent', () => {
  const ordinary = (): DocsPage => ({
    contentLocale: 'en-US',
    source: 'docs/guide.md',
    route: 'guide/index.md',
    label: 'Guide',
    sidebar: 'guide',
    section: 'Guide',
    order: 1,
  })
  const home = (): DocsPage => ({
    contentLocale: 'en-US',
    source: 'docs/user/index.md',
    route: 'index.md',
    label: 'Home',
    sidebar: null,
    section: 'Home',
    order: 0,
  })

  it('omits the source-only body from the home redirect stub', () => {
    expect(projectedPageContent(
      '---\nlayout: false\nhead:\n  - - meta\n    - http-equiv: refresh\n      content: 0; url=./guide/quickstart\n---\n\n# Harness\n',
      home(),
    )).toBe('---\nlayout: false\nhead:\n  - - meta\n    - http-equiv: refresh\n      content: 0; url=./guide/quickstart\n---\n')
  })

  it('keeps the full body for ordinary pages', () => {
    const markdown = '---\ntitle: Guide\n---\n\n# Guide\n'
    expect(projectedPageContent(markdown, ordinary())).toBe(markdown)
  })

  it('rejects a home source without frontmatter', () => {
    expect(() => projectedPageContent('# Harness\n', home()))
      .toThrow('home source "docs/user/index.md" must start with YAML frontmatter')
  })
})

describe('withoutRepositoryChrome', () => {
  it('drops the repository badge every page links from its footer', () => {
    const badge = '[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)'
    expect(withoutRepositoryChrome(`# Guide\n\nBody.\n\n${badge}\n`)).toBe('# Guide\n\nBody.\n')
  })
})
