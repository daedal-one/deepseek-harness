/**
 * Validate the repository `.specs/` tree against the Specs Format baseline
 * declared in `.specs/_config.toml` (upstream: daedal-one/forge-spec,
 * `specification.md`, Specs Format v0.7, CLI spec v0.8).
 *
 * The gate checks the parts of the format the repository authors: frontmatter
 * parses and carries the required fields per type, document IDs follow
 * `TYPE:<area>/<slug>` and agree with their path, lifecycle status and TASK
 * progress use the upstream enums, cross-references (`refines`, `addresses`,
 * `blocked_by`) resolve to existing documents and clause anchors, and
 * `_config.toml` names an existing PROJECT document.
 *
 * It prints nothing when the tree is clean and writes `file:line` diagnostics
 * with a non-zero exit when it is not. Deeper upstream rules (refinement
 * cycles, level monotonicity, clause coverage, redirects, enrollment) are
 * deliberately out of scope: this gate owns the mechanically checkable
 * document and reference contract, not the semantic graph.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { load } from 'js-yaml'
import { parse as parseToml } from 'smol-toml'

/** Repository root used when no explicit root is supplied. */
const REPO_ROOT = resolve(import.meta.dirname, '..')

/** The frontmatter delimiter every spec document opens with. */
const FRONTMATTER_FENCE = '---'

/** Upstream lifecycle enum for the universal `status` field. */
const STATUS_VALUES = ['draft', 'accepted', 'deprecated', 'superseded'] as const

/** Upstream work-item enum for the TASK-only `progress` field. */
const PROGRESS_VALUES = ['pending', 'in-progress', 'done', 'blocked', 'deferred', 'wontdo'] as const

/** Upstream requirement-strength enum for the REQ-only `level` field. */
const LEVEL_VALUES = ['MUST', 'SHOULD', 'MAY', 'INFO'] as const

/** Document `type` value to the ID prefix upstream registers for it. */
const TYPE_PREFIX: Record<string, string> = {
  project: 'PROJECT',
  requirement: 'REQ',
  interface: 'IFC',
  task: 'TASK',
}

/** The format baseline grammar `.specs/_config.toml` must declare. */
const BASELINE_PATTERN = /^forge-spec-v\d+\.\d+\.\d+$/

/** Universal frontmatter fields every spec document declares. */
const UNIVERSAL_REQUIRED = ['id', 'type', 'status', 'summary', 'owners'] as const

/** Required fields beyond the universal set, per document `type`. */
const TYPE_REQUIRED: Record<string, readonly string[]> = {
  project: [],
  requirement: ['level'],
  interface: [],
  task: ['progress', 'addresses'],
}

/** Fields that must parse as a non-empty list of strings when present. */
const LIST_FIELDS = ['owners', 'refines', 'addresses', 'blocked_by', 'labels', 'related', 'categorized_under', 'groups'] as const

/** One `file:line` finding; `line` is 1-based within the diagnosed file. */
export interface SpecViolation {
  /** Path relative to the linted root, or `_config.toml` for the config file. */
  file: string
  /** 1-based line the finding points at; 0 when the whole file is at fault. */
  line: number
  /** Human-readable contract failure. */
  message: string
}

/** The parsed frontmatter of one spec document, with source locations. */
interface SpecDocument {
  /** Path relative to the linted root. */
  file: string
  /** Document ID from frontmatter, or null when the document is unparsable. */
  id: string | null
  /** Declared `type`, or null when missing or malformed. */
  type: string | null
  /** Parsed frontmatter mapping. */
  fields: Record<string, unknown>
  /** 1-based line of each top-level frontmatter key. */
  keyLines: Map<string, number>
  /** Clause anchors (`{#c-...}`) and typed-block IDs the document exposes. */
  anchors: Set<string>
}

/** Frontmatter split out of a `.spec.md` document. */
interface Frontmatter {
  /** Raw YAML between the opening and closing fence. */
  source: string
  /** 1-based line where the YAML block starts. */
  startLine: number
  /** The document body after the closing fence. */
  body: string
}

/** A parsed document or the parse failure that stopped validation. */
type ParseResult = { ok: true; document: SpecDocument } | { ok: false; violation: SpecViolation }

/**
 * Split YAML frontmatter from a spec document body.
 * @param source - full document text.
 * @returns the frontmatter block and body, or null when the fences are missing.
 */
function splitFrontmatter(source: string): Frontmatter | null {
  const lines = source.split('\n')
  if (lines[0] !== FRONTMATTER_FENCE) return null
  const end = lines.indexOf(FRONTMATTER_FENCE, 1)
  if (end === -1) return null
  return {
    source: lines.slice(1, end).join('\n'),
    startLine: 2,
    body: lines.slice(end + 1).join('\n'),
  }
}

/**
 * Collect every anchor a spec document exposes: typed-block IDs from
 * `:::{kind id="..."}` directives and clause anchors from `{#c-...}` markers
 * inside typed blocks. Both are addressable as `<doc-id>#<anchor>` upstream.
 * @param body - document body after the frontmatter.
 * @returns the set of anchor names declared in the body.
 */
function collectAnchors(body: string): Set<string> {
  const anchors = new Set<string>()
  for (const match of body.matchAll(/\{#([A-Za-z0-9_-]+)\}/g)) {
    if (match[1] !== undefined) anchors.add(match[1])
  }
  for (const match of body.matchAll(/:::\{[a-z-]+\s+id="([^"]+)"/g)) {
    if (match[1] !== undefined) anchors.add(match[1])
  }
  return anchors
}

/**
 * Record the 1-based line of every top-level frontmatter key so diagnostics
 * point at the offending field rather than the document.
 * @param yamlSource - raw frontmatter YAML.
 * @param startLine - 1-based line where the YAML block starts.
 * @returns the key-to-line map.
 */
function frontmatterKeyLines(yamlSource: string, startLine: number): Map<string, number> {
  const keyLines = new Map<string, number>()
  load(yamlSource, {
    listener: (_event, state) => {
      if (typeof state.result !== 'string') return
      const key = state.result
      if (!/^[a-z_][a-z0-9_]*$/.test(key)) return
      if (!keyLines.has(key)) keyLines.set(key, startLine + state.line)
    },
  })
  return keyLines
}

/**
 * Parse one `.spec.md` document into its frontmatter fields and anchors.
 * @param file - path relative to the linted root, used in diagnostics.
 * @param source - full document text.
 * @returns the parsed document, or the violation that made it unparsable.
 */
function parseSpecDocument(file: string, source: string): ParseResult {
  const frontmatter = splitFrontmatter(source)
  if (frontmatter === null) {
    return { ok: false, violation: { file, line: 1, message: 'missing YAML frontmatter delimited by `---`' } }
  }

  let parsed: unknown
  try {
    parsed = load(frontmatter.source)
  } catch (error) {
    // js-yaml is the only thrower here; its message names the YAML defect and
    // carries the line inside the frontmatter block.
    const detail = error instanceof Error ? error.message.split('\n')[0] ?? error.message : String(error)
    return { ok: false, violation: { file, line: frontmatter.startLine, message: `frontmatter is not valid YAML: ${detail}` } }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, violation: { file, line: frontmatter.startLine, message: 'frontmatter must be a YAML mapping' } }
  }

  const fields = parsed as Record<string, unknown>
  const keyLines = frontmatterKeyLines(frontmatter.source, frontmatter.startLine)
  const id = typeof fields.id === 'string' ? fields.id : null
  const type = typeof fields.type === 'string' ? fields.type : null
  return { ok: true, document: { file, id, type, fields, keyLines, anchors: collectAnchors(frontmatter.body) } }
}

/**
 * True when a frontmatter value is present as a list of strings.
 * @param value - parsed frontmatter value.
 * @returns whether the value is a string array.
 */
function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
}

/**
 * The 1-based line a field diagnostic should name.
 * @param document - document the field belongs to.
 * @param field - frontmatter key.
 * @returns the key's line, or the first line when the parser recorded none.
 */
function fieldLine(document: SpecDocument, field: string): number {
  return document.keyLines.get(field) ?? 1
}

/**
 * Split a reference into its document ID and optional `#anchor`.
 * @param reference - a frontmatter reference such as `REQ:auth/foo#c-bar`.
 * @returns the document ID and anchor (null when the reference has none).
 */
function splitReference(reference: string): { id: string; anchor: string | null } {
  const hash = reference.indexOf('#')
  if (hash === -1) return { id: reference, anchor: null }
  return { id: reference.slice(0, hash), anchor: reference.slice(hash + 1) }
}

/**
 * Validate one document's universal and type-specific frontmatter.
 * @param document - parsed document.
 * @param violations - accumulator for findings.
 */
function checkFields(document: SpecDocument, violations: SpecViolation[]): void {
  const { fields } = document
  const fail = (field: string, message: string): void => {
    violations.push({ file: document.file, line: fieldLine(document, field), message })
  }

  for (const field of UNIVERSAL_REQUIRED) {
    const value = fields[field]
    if (value === undefined || value === null) {
      fail(field, `missing required frontmatter field \`${field}\``)
      continue
    }
    if (field === 'owners') {
      if (!isStringList(value) || value.length === 0) fail(field, '`owners` must be a non-empty list of identifiers')
    } else if (typeof value !== 'string' || value.trim() === '') {
      fail(field, `\`${field}\` must be a non-empty string`)
    }
  }

  if (document.type === null) return
  const prefix = TYPE_PREFIX[document.type]
  if (prefix === undefined) {
    fail('type', `\`type\` must be one of ${Object.keys(TYPE_PREFIX).join(', ')}`)
    return
  }

  for (const field of TYPE_REQUIRED[document.type] ?? []) {
    const value = fields[field]
    if (value === undefined || value === null) fail(field, `\`${document.type}\` documents require \`${field}\``)
  }

  for (const field of LIST_FIELDS) {
    const value = fields[field]
    if (value === undefined) continue
    if (!isStringList(value)) fail(field, `\`${field}\` must be a list of strings`)
  }

  const status = fields.status
  if (typeof status === 'string' && !(STATUS_VALUES as readonly string[]).includes(status)) {
    fail('status', `\`status\` must be one of ${STATUS_VALUES.join(', ')}; found \`${status}\``)
  }

  const progress = fields.progress
  if (document.type === 'task' && typeof progress === 'string' && !(PROGRESS_VALUES as readonly string[]).includes(progress)) {
    fail('progress', `\`progress\` must be one of ${PROGRESS_VALUES.join(', ')}; found \`${progress}\``)
  }

  const level = fields.level
  if (document.type === 'requirement' && typeof level === 'string' && !(LEVEL_VALUES as readonly string[]).includes(level)) {
    fail('level', `\`level\` must be one of ${LEVEL_VALUES.join(', ')}; found \`${level}\``)
  }

  if (document.type !== 'project' && document.id !== null && !document.id.startsWith(`${prefix}:`)) {
    fail('id', `\`id\` must start with \`${prefix}:\` for a \`${document.type}\` document; found \`${document.id}\``)
  }
}

/**
 * Validate that a document's ID, filename stem, and directory agree.
 * @param document - parsed document.
 * @param violations - accumulator for findings.
 */
function checkIdentity(document: SpecDocument, violations: SpecViolation[]): void {
  if (document.id === null) return
  const fail = (message: string): void => {
    violations.push({ file: document.file, line: fieldLine(document, 'id'), message })
  }

  const segments = document.file.split('/')
  const filename = segments.at(-1) ?? ''
  const stem = filename.replace(/\.spec\.md$/, '')
  const directory = segments.length > 1 ? segments.at(-2) ?? '' : ''

  if (document.type === 'project') {
    if (filename !== '_project.spec.md') fail('the PROJECT document must live at `.specs/_project.spec.md`')
    return
  }

  const idMatch = /^([A-Z]+):([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(document.id)
  if (idMatch === null) {
    fail(`\`id\` must match \`TYPE:<area>/<slug>\` in kebab-case; found \`${document.id}\``)
    return
  }
  const area = idMatch[2] ?? ''
  const slug = idMatch[3] ?? ''
  if (slug !== stem) fail(`\`id\` slug \`${slug}\` must equal the filename stem \`${stem}\``)

  if (document.type === 'task') {
    if (directory === 'tasks') return
    if (directory !== area) fail(`a TASK outside \`.specs/tasks/\` must live in its id area directory \`.specs/${area}/\`; found \`.specs/${directory}/\``)
    return
  }

  if (directory !== area) fail(`a \`${document.type}\` document must live at \`.specs/${area}/${stem}.spec.md\` to match its id area; found \`${document.file}\``)
}

/**
 * Validate every cross-reference a document declares against the document set.
 * @param document - parsed document.
 * @param documents - every parsed document, keyed by ID.
 * @param violations - accumulator for findings.
 */
function checkReferences(document: SpecDocument, documents: Map<string, SpecDocument>, violations: SpecViolation[]): void {
  const check = (field: string, entries: string[]): void => {
    for (const entry of entries) {
      const { id, anchor } = splitReference(entry)
      const target = documents.get(id)
      if (target === undefined) {
        violations.push({ file: document.file, line: fieldLine(document, field), message: `\`${field}\` entry \`${entry}\` does not resolve to a spec in the tree` })
        continue
      }
      if (anchor === null) continue
      if (!target.anchors.has(anchor)) {
        violations.push({ file: document.file, line: fieldLine(document, field), message: `\`${field}\` entry \`${entry}\` names no \`{#${anchor}}\` anchor in \`${id}\`` })
      }
    }
  }

  for (const field of ['refines', 'addresses'] as const) {
    const value = document.fields[field]
    if (isStringList(value)) check(field, value)
  }

  const blockedBy = document.fields.blocked_by
  if (document.type === 'task' && blockedBy !== undefined && blockedBy !== null && !isStringList(blockedBy)) {
    violations.push({ file: document.file, line: fieldLine(document, 'blocked_by'), message: '`blocked_by` must be a list of `TASK:` ids; an absent value is not a list' })
  }
  if (isStringList(blockedBy)) {
    check('blocked_by', blockedBy)
    for (const entry of blockedBy) {
      const target = documents.get(splitReference(entry).id)
      if (target !== undefined && target.type !== 'task') {
        violations.push({ file: document.file, line: fieldLine(document, 'blocked_by'), message: `\`blocked_by\` entry \`${entry}\` must name a \`task\` document; found \`${target.type ?? 'unknown'}\`` })
      }
    }
  }
}

/**
 * Collect every `.spec.md` path under a `.specs` directory.
 * @param specsRoot - absolute path of the `.specs` directory.
 * @returns paths relative to the linted root, sorted for deterministic output.
 */
function specFiles(specsRoot: string): string[] {
  const found: string[] = []
  const walk = (absolute: string, prefix: string): void => {
    for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(absolute, entry.name)
      const relativeChild = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(child, relativeChild)
      else if (entry.name.endsWith('.spec.md')) found.push(relativeChild)
    }
  }
  walk(specsRoot, '')
  return found
}

/**
 * Validate `.specs/_config.toml`: the baseline grammar and a project ID that
 * exists in the tree.
 * @param specsRoot - absolute path of the linted `.specs` directory.
 * @param documents - every parsed document, keyed by ID.
 * @returns the config findings.
 */
function checkConfig(specsRoot: string, documents: Map<string, SpecDocument>): SpecViolation[] {
  const file = '_config.toml'
  const path = join(specsRoot, file)
  let source: string
  try {
    source = readFileSync(path, 'utf8')
  } catch {
    // Only a missing or unreadable config reaches here; the config file is a
    // required part of the tree, so report it rather than skipping the gate.
    return [{ file, line: 0, message: 'missing `.specs/_config.toml`' }]
  }

  let parsed: unknown
  try {
    parsed = parseToml(source)
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n')[0] ?? error.message : String(error)
    return [{ file, line: 0, message: `_config.toml is not valid TOML: ${detail}` }]
  }
  if (parsed === null || typeof parsed !== 'object') return [{ file, line: 0, message: '_config.toml must contain a TOML table' }]

  const config = parsed as Record<string, unknown>
  const violations: SpecViolation[] = []
  const lineOf = (key: string): number => {
    const index = source.split('\n').findIndex(line => line.startsWith(key))
    return index === -1 ? 0 : index + 1
  }

  const baseline = config.baseline
  if (typeof baseline !== 'string' || !BASELINE_PATTERN.test(baseline)) {
    violations.push({ file, line: lineOf('baseline'), message: `\`baseline\` must match \`forge-spec-v<major>.<minor>.<patch>\`; found \`${String(baseline)}\`` })
  }

  const project = config.project
  if (typeof project !== 'string') {
    violations.push({ file, line: lineOf('project'), message: '`project` must name the tree\'s PROJECT document' })
  } else {
    const target = documents.get(project)
    if (target === undefined) violations.push({ file, line: lineOf('project'), message: `\`project\` id \`${project}\` does not resolve to a spec in the tree` })
    else if (target.type !== 'project') violations.push({ file, line: lineOf('project'), message: `\`project\` id \`${project}\` must name a \`project\` document; found \`${target.type ?? 'unknown'}\`` })
  }

  return violations
}

/**
 * Lint one `.specs` tree.
 * @param root - repository root containing the `.specs` directory.
 * @returns every finding, ordered by file then line; empty when the tree is clean.
 */
export function lintSpecTree(root: string): SpecViolation[] {
  const specsRoot = join(root, '.specs')
  const violations: SpecViolation[] = []
  const documents = new Map<string, SpecDocument>()

  let files: string[]
  try {
    files = specFiles(specsRoot)
  } catch {
    // Only a missing or unreadable `.specs` directory reaches here.
    return [{ file: '.specs', line: 0, message: 'missing `.specs` directory' }]
  }

  for (const file of files) {
    const result = parseSpecDocument(`.specs/${file}`, readFileSync(join(specsRoot, file), 'utf8'))
    if (!result.ok) {
      violations.push(result.violation)
      continue
    }
    const document = result.document
    checkFields(document, violations)
    checkIdentity(document, violations)
    if (document.id !== null) {
      const existing = documents.get(document.id)
      if (existing !== undefined) {
        violations.push({ file: document.file, line: fieldLine(document, 'id'), message: `duplicate id \`${document.id}\`, already declared by \`${existing.file}\`` })
      } else {
        documents.set(document.id, document)
      }
    }
  }

  for (const document of documents.values()) checkReferences(document, documents, violations)
  violations.push(...checkConfig(specsRoot, documents))

  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.message.localeCompare(b.message))
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  const rootIndex = process.argv.indexOf('--root')
  const root = rootIndex === -1 ? REPO_ROOT : resolve(process.argv[rootIndex + 1] ?? '')
  const violations = lintSpecTree(root)
  if (violations.length > 0) {
    console.error('spec-lint: spec tree violates the Specs Format baseline:')
    for (const violation of violations) console.error(`  ${violation.file}:${violation.line}  ${violation.message}`)
    process.exit(1)
  }
}
