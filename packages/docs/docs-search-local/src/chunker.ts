/**
 * Corpus scanning and section-level chunking for the docs-search index.
 *
 * Each chunk is one Markdown section keyed by the corpus kind its file lives
 * in, carrying the repository-relative file, the anchor that addresses the
 * section inside it, the section title, the embedded body text, and a SHA-256
 * hash of that body. The hash is what makes a re-index incremental: a chunk
 * whose body did not change is never re-embedded.
 * @module @deepseek-ai/dsh-docs-search-local/chunker
 */

import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
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
  /** SHA-256 hex digest of `body`, used to detect changed chunks across builds. */
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
  const sections = splitSections(body)
  const chunks: DocsChunk[] = []
  if (frontmatter.length > 0) {
    const summary = frontmatterField(frontmatter, 'summary')
    if (summary !== undefined) {
      chunks.push(makeChunk(context, 'frontmatter', 'Summary', summary))
    }
  }
  for (const section of sections) {
    const text = boundBody(dropLongFences(section.body, context.maxCodeLines), context.maxBodyChars)
    const title = `${context.titlePrefix}${section.title}`
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
    hash: createHash('sha256').update(body).digest('hex'),
  }
}

/**
 * Derive the slug anchor for a heading, matching the spellings the repository's
 * link gate resolves: lowercase, punctuation dropped, spaces hyphenated.
 * @param heading - heading text without its leading markers.
 * @returns the heading slug, or `section` when the heading has no slug characters.
 */
export function headingSlug(heading: string): string {
  const slug = heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/gu, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/gu, '-')
  return slug.length === 0 ? 'section' : slug
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
    if (/^\S/u.test(line) && line.trim().length > 0) break
    parts.push(line.trim())
  }
  const value = parts.join(' ').trim()
  return value.length === 0 ? undefined : value
}

/** Split body lines into sections at headings outside fenced code blocks. */
function splitSections(lines: readonly string[]): DocsSection[] {
  const sections: DocsSection[] = []
  let fence: string | undefined
  let current: { anchor: string; title: string; body: string[] } = { anchor: 'document', title: '', body: [] }
  for (const line of lines) {
    const match = /^\s*(`{3,}|~{3,})/u.exec(line)
    const marker = match?.[1]
    if (marker !== undefined) {
      if (fence === undefined) fence = marker
      else if (line.trim().startsWith(fence)) fence = undefined
      current.body.push(line)
      continue
    }
    const title = fence === undefined ? /^(?:#{1,6})\s+(.*)$/u.exec(line)?.[1]?.trim() : undefined
    if (title !== undefined) {
      sections.push({ anchor: current.anchor, title: current.title, body: current.body.join('\n') })
      current = { anchor: headingSlug(title), title, body: [] }
      continue
    }
    current.body.push(line)
  }
  sections.push({ anchor: current.anchor, title: current.title, body: current.body.join('\n') })
  return sections
}

/**
 * Drop the body of a fenced code block longer than `maxCodeLines`, keeping the
 * block locatable through a one-line placeholder. Prose embeddings should not
 * carry whole source files, but the section still has to be findable.
 */
function dropLongFences(body: string, maxCodeLines: number): string {
  const kept: string[] = []
  const lines = body.split('\n')
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1]
    if (marker === undefined) {
      kept.push(line)
      index += 1
      continue
    }
    let end = index + 1
    while (end < lines.length && !(lines[end] ?? '').trim().startsWith(marker)) end += 1
    const contentLines = end - index - 1
    if (contentLines > maxCodeLines) {
      kept.push(line, `[${contentLines} code lines omitted]`)
      const closing = lines[end]
      if (closing !== undefined) kept.push(closing)
    } else {
      kept.push(...lines.slice(index, Math.min(end + 1, lines.length)))
    }
    index = end + 1
  }
  return kept.join('\n')
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
      if (!await isFile(path)) continue
      found.push(path)
    }
  }
  await visit(directory, rule.recursive)
  return found
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Derive the package name carried by a package README path. */
function packageNameOf(repoRelative: string): string {
  const parts = repoRelative.split('/')
  const name = parts.length >= 3 && parts[0] === 'packages' ? parts[2] : undefined
  return name === undefined ? '' : `@deepseek-ai/dsh-${name}`
}
