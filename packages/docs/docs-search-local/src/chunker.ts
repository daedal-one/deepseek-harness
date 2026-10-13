/**
 * Corpus scanning and section-level chunking for the docs-search index.
 *
 * Each chunk is one Markdown section keyed by the corpus kind its file lives
 * in, carrying the repository-relative file, the anchor that addresses the
 * section inside it, the section title, the embedded body text, and a SHA-256
 * hash of its kind, title, and body for incremental indexing.
 * @module @deepseek-ai/dsh-docs-search-local/chunker
 */

import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import GithubSlugger, { slug } from 'github-slugger'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { toString } from 'mdast-util-to-string'
import { visit } from 'unist-util-visit'
import type { DocsSourceKind } from '@deepseek-ai/dsh-docs-search'

/** One corpus file class: where its files live and what kind it contributes. */
export interface DocsCorpusRule {
  /** Corpus kind every chunk from a matching file carries. */
  kind: DocsSourceKind
  /** Repository-relative directory the rule scans. */
  root: string
  /** File basename suffix a candidate path must carry. */
  suffix: string
  /** Whether the rule scans `root` recursively. */
  recursive: boolean
  /** Package-README rule: the section title is prefixed with the package name. */
  packageReadme: boolean
}

/** Whether a document's non-fenced line opened a `##` section heading. */
export interface DocsSection {
  /** Markdown heading slug derived from the heading text. */
  anchor: string
  /** Heading text without its leading markers. */
  title: string
  /** Body lines between this heading and the next section heading. */
  body: string
}

/** One embeddable documentation section. */
export interface DocsChunk {
  /** Corpus kind the owning file belongs to. */
  kind: DocsSourceKind
  /** Repository-relative path of the owning file. */
  file: string
  /** Section anchor inside `file`. */
  anchor: string
  /** Section title as stored, including a package-name prefix where the corpus rule adds one. */
  title: string
  /** Embedded body text with over-long fenced code blocks removed. */
  body: string
  /** SHA-256 hex digest of kind, title, and body, used to detect changed chunks across builds. */
  hash: string
}

/** Options that bound one corpus scan. */
export interface DocsCorpusOptions {
  /** Absolute repository root every corpus rule is resolved against. */
  root: string
  /** Corpus rules to scan, in the order their files are visited. */
  rules: readonly DocsCorpusRule[]
  /** Maximum characters retained from one section body; longer bodies are truncated. */
  maxBodyChars: number
  /** Fence body length above which a fenced code block is dropped from the embedded text. */
  maxCodeLines: number
}

/**
 * The default corpus: this repository's own documentation, one rule per source
 * kind. `.agents/notes/implemented` is deliberately absent — notes are opt-in
 * because indexing every implemented note multiplies the first build.
 * @returns the ordered default rules.
 */
export function defaultDocsCorpusRules(): DocsCorpusRule[] {
  return [
    { kind: 'readme', root: 'packages', suffix: 'README.md', recursive: true, packageReadme: true },
    { kind: 'catalog', root: 'docs', suffix: 'config-catalog.md', recursive: false, packageReadme: false },
    { kind: 'catalog', root: 'docs', suffix: 'tool-catalog.md', recursive: false, packageReadme: false },
    { kind: 'subsystem', root: 'docs/subsystems', suffix: '.md', recursive: false, packageReadme: false },
    { kind: 'guide', root: 'docs/user', suffix: '.md', recursive: true, packageReadme: false },
    { kind: 'spec', root: '.specs', suffix: '.spec.md', recursive: true, packageReadme: false },
  ]
}

/**
 * Scan every corpus rule and chunk the files it matches.
 * @param options - repository root, rules, and body bounds.
 * @returns every chunk in rule order, then path order within a rule.
 */
export async function scanDocsCorpus(options: DocsCorpusOptions): Promise<DocsChunk[]> {
  const chunks: DocsChunk[] = []
  for (const rule of options.rules) {
    const directory = join(options.root, ...rule.root.split('/'))
    const files = await listCorpusFiles(directory, rule)
    for (const file of files.sort()) {
      const source = await readFile(file, 'utf8')
      const repoRelative = relative(options.root, file).split(sep).join('/')
      const titlePrefix = rule.packageReadme ? `${packageNameOf(repoRelative)} ` : ''
      chunks.push(...chunkMarkdown(source, {
        kind: rule.kind,
        file: repoRelative,
        titlePrefix,
        maxBodyChars: options.maxBodyChars,
        maxCodeLines: options.maxCodeLines,
      }))
    }
  }
  return chunks
}

/** Context one Markdown source is chunked under. */
interface ChunkContext {
  kind: DocsSourceKind
  file: string
  titlePrefix: string
  maxBodyChars: number
  maxCodeLines: number
}

/**
 * Split one Markdown source into section chunks.
 *
 * A section is delimited by lines outside fenced code blocks: the first
 * heading of any level starts the preamble carried as the document's top
 * section, and every later heading starts one section. Task specifications
 * additionally contribute a frontmatter section from their `summary` field.
 * @param source - complete Markdown file contents.
 * @param context - corpus kind, file path, title prefix, and body bounds.
 * @returns one chunk per section that carries a body or a title.
 */
export function chunkMarkdown(source: string, context: ChunkContext): DocsChunk[] {
  const lines = source.split('\n')
  const { body, frontmatter } = splitFrontmatter(lines)
  const summary = frontmatterField(frontmatter, 'summary')
  const sections = splitSections(body)
  const chunks: DocsChunk[] = []
  for (const section of sections) {
    const content = section.anchor === '' && summary !== undefined ? `${summary}\n${section.body}` : section.body
    const text = boundBody(dropLongFences(content, context.maxCodeLines).trim(), context.maxBodyChars)
    const title = `${context.titlePrefix}${section.anchor === '' && summary !== undefined ? 'Summary' : section.title}`
    if (text.length === 0 && section.title.length === 0) continue
    chunks.push(makeChunk(context, section.anchor, title, text))
  }
  return chunks
}

function makeChunk(context: ChunkContext, anchor: string, title: string, body: string): DocsChunk {
  return {
    kind: context.kind,
    file: context.file,
    anchor,
    title,
    body,
    hash: createHash('sha256').update(JSON.stringify([context.kind, title, body])).digest('hex'),
  }
}

/**
 * Derive the slug anchor for a heading, matching the spellings the repository's
 * link gate resolves: lowercase, punctuation dropped, spaces hyphenated.
 * @param heading - heading text without its leading markers.
 * @returns the heading slug, including an empty fragment for headings with no slug characters.
 */
export function headingSlug(heading: string): string {
  return slug(toString(fromMarkdown(heading), { includeHtml: false }))
}

/** Split a Markdown source into frontmatter lines and body lines. */
function splitFrontmatter(lines: readonly string[]): { body: string[]; frontmatter: string[] } {
  if (lines[0]?.trim() !== '---') return { body: [...lines], frontmatter: [] }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end === -1) return { body: [...lines], frontmatter: [] }
  return { body: lines.slice(end + 1), frontmatter: lines.slice(1, end) }
}

/** Read one scalar field from frontmatter lines, folding a multi-line value. */
function frontmatterField(frontmatter: readonly string[], key: string): string | undefined {
  const prefix = `${key}:`
  const start = frontmatter.findIndex(line => line.startsWith(prefix))
  const first = start === -1 ? undefined : frontmatter[start]
  if (first === undefined) return undefined
  const parts: string[] = [first.slice(prefix.length).trim()]
  for (const line of frontmatter.slice(start + 1)) {
    if (/^\S/u.test(line)) break
    parts.push(line.trim())
  }
  const value = parts.join(' ').trim()
  return value.length === 0 ? undefined : value
}

/** Split body lines into sections at headings outside fenced code blocks. */
function splitSections(lines: readonly string[]): DocsSection[] {
  const source = lines.join('\n')
  const headings: Array<{ anchor: string; title: string; start: number; end: number }> = []
  const slugger = new GithubSlugger()
  visit(fromMarkdown(source), 'heading', (node) => {
    // The parser assigns offsets to every parsed node.
    const position = node.position as { start: { offset: number }; end: { offset: number } }
    const title = toString(node, { includeHtml: false })
    headings.push({
      anchor: slugger.slug(title), title,
      start: position.start.offset, end: position.end.offset,
    })
  })
  const sections: DocsSection[] = [{ anchor: '', title: '', body: source.slice(0, headings[0]?.start) }]
  headings.forEach((heading, index) => {
    sections.push({ anchor: heading.anchor, title: heading.title, body: source.slice(heading.end, headings[index + 1]?.start) })
  })
  return sections
}

/** Elide long parsed code blocks while preserving surrounding prose. */
function dropLongFences(body: string, maxCodeLines: number): string {
  const replacements: Array<{ start: number; end: number; text: string }> = []
  visit(fromMarkdown(body), 'code', (node) => {
    const position = node.position as { start: { offset: number }; end: { offset: number } }
    const count = node.value.split('\n').length
    if (count > maxCodeLines) replacements.push({
      start: position.start.offset, end: position.end.offset,
      text: `[${count} code lines omitted]`,
    })
  })
  let result = body
  for (const replacement of replacements.reverse()) {
    result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end)
  }
  return result
}

/** Truncate an over-long body to the configured character budget. */
function boundBody(body: string, maxBodyChars: number): string {
  if (body.length <= maxBodyChars) return body
  return `${body.slice(0, maxBodyChars)}…`
}

/** List the corpus files one rule matches, skipping absent roots. */
async function listCorpusFiles(directory: string, rule: DocsCorpusRule): Promise<string[]> {
  const found: string[] = []
  const visit = async (current: string, recursive: boolean): Promise<void> => {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch (error: unknown) {
      // A corpus root that does not exist contributes no files; a read failure
      // below a root that does exist is a real fault and propagates.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        if (recursive) await visit(path, true)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith(rule.suffix)) continue
      if (rule.suffix === 'README.md' && entry.name !== 'README.md') continue
      found.push(path)
    }
  }
  await visit(directory, rule.recursive)
  return found
}

/** Derive the package name carried by a package README path. */
function packageNameOf(repoRelative: string): string {
  const parts = repoRelative.split('/')
  const name = parts.length >= 3 && parts[0] === 'packages' ? parts[2] : undefined
  return name === undefined ? repoRelative : `@deepseek-ai/dsh-${name}`
}
