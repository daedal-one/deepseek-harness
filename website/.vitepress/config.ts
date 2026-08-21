/** VitePress configuration for the locally projected documentation site. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ViteDevServer } from 'vite'
import type { DefaultTheme } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'
import { landingLink, orderedPages, routeLink, sectionSpec, type DocsPage, type DocsSidebar } from '../docs.ts'
import { docsSourceFiles, projectDocs } from '../../scripts/project-doc-site.ts'

// The build compiles the disposable generated tree, so the projector must
// populate it before VitePress resolves any of its sources.
projectDocs()

function watchCanonicalDocs(server: ViteDevServer): void {
  const sources = docsSourceFiles()
  server.watcher.add(sources)
  server.watcher.on('change', (changed) => {
    if (!sources.includes(changed)) return
    projectDocs()
  })
}

function sidebar(collection: NonNullable<DocsPage['sidebar']>): DefaultTheme.SidebarItem[] {
  // `orderedPages` already sorts by section placement, so insertion order
  // carries the group order and each group keeps its pages in sequence.
  const groups = new Map<string, DocsPage[]>()
  for (const page of orderedPages(collection)) {
    const entries = groups.get(page.section) ?? []
    entries.push(page)
    groups.set(page.section, entries)
  }
  return [...groups.entries()].map(([text, entries]) => {
    const { collapsed } = sectionSpec(text)
    return {
      text,
      // A present `collapsed` is what makes the default theme render the
      // group as collapsible at all, so an open group must omit the key.
      ...(collapsed === undefined ? {} : { collapsed }),
      items: entries.map(page => ({ text: page.label, link: routeLink(page.route) })),
    }
  })
}

/** Guide sidebar with direct links into the first development and reference pages. */
function guideSidebar(): DefaultTheme.SidebarItem[] {
  return [
    ...sidebar('guide'),
    ...[
      { label: 'Development', collection: 'develop' as DocsSidebar },
      { label: 'Reference', collection: 'reference' as DocsSidebar },
    ].map(({ label, collection }) => ({
      text: label,
      link: landingLink(collection),
    })),
  ]
}

/** Navigation-bar items for the modules beyond the guide. */
function moduleNav(): DefaultTheme.NavItem[] {
  return [
    { text: 'Development', link: landingLink('develop'), activeMatch: '^/develop/' },
    { text: 'Reference', link: landingLink('reference'), activeMatch: '^/reference/' },
  ]
}

function escapeVueInterpolation(html: string): string {
  return html.replaceAll('{{', '&#123;&#123;').replaceAll('}}', '&#125;&#125;')
}

/** Site base path, carrying the leading and trailing slashes VitePress requires. */
const base = process.env.DOCS_BASE ?? '/'

/**
 * The DeepSeek wordmark, inlined so its `currentColor` fills follow the active
 * theme. An `<img>` would freeze the mark at the colors the file declares.
 */
const wordmark = readFileSync(resolve(import.meta.dirname, '../public/wordmark.svg'), 'utf8')
  .trim()
  .replace('<svg ', '<svg class="dsh-wordmark" ')

/**
 * Styles the default theme does not provide, carried inline because the site
 * runs the stock theme with no theme directory of its own.
 *
 * The navigation-bar lockup pairs with `siteTitle`. The scrollbar rules replace
 * the sidebar's platform bar, which reserves 15px of a 265px column and draws a
 * track the rest of the navigation has no border for; `scrollbarScript` supplies
 * the marker that reveals the thumb. Chrome drops `::-webkit-scrollbar` once
 * `scrollbar-width` is set to anything but `auto`, so the standard properties
 * stay behind a query only Firefox answers.
 */
const siteStyle = `
.dsh-lockup { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-wordmark { display: block; height: 22px; width: auto; color: var(--vp-c-text-1); }
.dsh-tag {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--vp-c-brand-soft);
  border-radius: 999px;
  padding: 1px 9px;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  white-space: nowrap;
  color: var(--vp-c-brand-1);
}

.VPSidebar::-webkit-scrollbar { width: 6px; }
.VPSidebar::-webkit-scrollbar-track { background: transparent; }
.VPSidebar::-webkit-scrollbar-thumb {
  background-color: transparent;
  border-radius: 3px;
  transition: background-color 0.3s;
}
.VPSidebar[data-scrolling]::-webkit-scrollbar-thumb { background-color: var(--vp-c-text-3); }
@supports not selector(::-webkit-scrollbar) {
  .VPSidebar { scrollbar-width: thin; scrollbar-color: transparent transparent; }
  .VPSidebar[data-scrolling] { scrollbar-color: var(--vp-c-text-3) transparent; }
}
`

/**
 * Mark the sidebar while it scrolls, so its scrollbar rests invisible.
 *
 * A sized `::-webkit-scrollbar` opts the element out of the platform's
 * self-hiding overlay bar, leaving one painted at all times; nothing in CSS
 * reports that an element is scrolling. The listener captures instead of
 * bubbling because scroll events do not bubble, and marks a `data-` attribute
 * rather than a class because Vue rewrites `class` wholesale when it patches
 * the element.
 */
const scrollbarScript = `
(() => {
  let idle
  addEventListener('scroll', (event) => {
    const target = event.target
    if (!(target instanceof Element) || !target.classList.contains('VPSidebar')) return
    target.dataset.scrolling = ''
    clearTimeout(idle)
    idle = setTimeout(() => delete target.dataset.scrolling, 800)
  }, true)
})()
`

/**
 * Navigation-bar title: the DeepSeek wordmark and the release-stage tag.
 * VitePress renders `siteTitle` as HTML.
 *
 * @param previewTag - Release-stage label.
 * @returns Markup placed beside the navigation-bar home link.
 */
function siteTitle(previewTag: string): string {
  return `<span class="dsh-lockup">${wordmark}<span class="dsh-tag">${previewTag}</span></span>`
}

export default withMermaid({
  title: 'DeepSeek Harness',
  description: 'Plugin-based SDK for building agent harnesses',
  base,
  head: [
    // VitePress leaves head hrefs untouched, so the base belongs here explicitly.
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }],
    ['style', {}, siteStyle],
    ['script', {}, scrollbarScript],
  ],
  cleanUrls: true,
  srcDir: '.generated',
  cacheDir: '.cache',
  outDir: '.dist',
  vite: {
    // `srcDir` puts the Vite root inside the disposable generated tree, whose
    // own `public/` no tracked asset can live in.
    publicDir: resolve(import.meta.dirname, '../public'),
    plugins: [
      {
        name: 'deepseek-harness-doc-projector',
        configureServer: watchCanonicalDocs,
      },
    ],
  },
  markdown: {
    config(md) {
      const renderText = md.renderer.rules.text
      const renderCode = md.renderer.rules.code_inline
      if (renderText === undefined || renderCode === undefined) {
        throw new Error('VitePress Markdown renderer is missing its text or inline-code rule.')
      }
      md.renderer.rules.text = (...args) => escapeVueInterpolation(renderText(...args))
      md.renderer.rules.code_inline = (...args) => escapeVueInterpolation(renderCode(...args))
    },
  },
  mermaid: {},
  lang: 'en-US',
  themeConfig: {
    siteTitle: siteTitle('Preview'),
    nav: [
      { text: 'Guide', link: landingLink('guide'), activeMatch: '^/guide/' },
      ...moduleNav(),
    ],
    sidebar: {
      '/guide/': guideSidebar(),
      '/develop/': sidebar('develop'),
      '/reference/': sidebar('reference'),
    },
    search: {
      provider: 'local',
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/deepseek-ai/deepseek-harness' },
    ],
    editLink: {
      pattern: 'https://github.com/deepseek-ai/deepseek-harness/edit/master/:path',
      text: 'Edit this page on GitHub',
    },
    outline: { label: 'On this page' },
    docFooter: { prev: 'Previous', next: 'Next' },
  },
})
