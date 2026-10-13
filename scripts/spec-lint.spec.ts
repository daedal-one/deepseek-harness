/**
 * Behavior coverage for the `.specs/` lint gate. Every case builds an inline
 * fixture tree in a private temporary directory, so the real repository specs
 * are never read or written.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { lintSpecTree } from './spec-lint.ts'

/** Fixture files keyed by their path under the fixture root; `undefined` removes a default file. */
type Fixture = Record<string, string | undefined>

/** Roots created by the current test, removed after it settles. */
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** The config every fixture shares; cases override it when the config is the subject. */
const CONFIG = [
  'baseline = "forge-spec-v0.7.0"',
  'project = "PROJECT:fixture"',
  'intellect_provider = "forge-intellect"',
  '',
].join('\n')

/** A PROJECT document, the root every valid tree needs. */
const PROJECT = [
  '---',
  'id: PROJECT:fixture',
  'type: project',
  'status: accepted',
  'summary: A fixture project.',
  'owners: [carlo]',
  '---',
  '',
  '# Fixture',
  '',
].join('\n')

/** A requirement document exposing one clause anchor inside a typed block. */
const REQUIREMENT = [
  '---',
  'id: REQ:auth/session-expiry',
  'type: requirement',
  'status: accepted',
  'level: MUST',
  'summary: Sessions expire after bounded intervals.',
  'owners: [carlo]',
  'refines: []',
  '---',
  '',
  ':::{requirement id="session-expiry" level="MUST"}',
  '- {#c-lifetime} bounded lifetime',
  ':::',
  '',
].join('\n')

/** A task document addressing the requirement's clause anchor. */
const TASK = [
  '---',
  'id: TASK:auth/expire-sessions',
  'type: task',
  'status: accepted',
  'summary: Implement bounded session expiry.',
  'owners: [carlo]',
  'progress: in-progress',
  'addresses: ["REQ:auth/session-expiry#c-lifetime"]',
  'blocked_by: []',
  '---',
  '',
  '# Expire sessions',
  '',
].join('\n')

/**
 * Write one fixture tree and lint it.
 * @param files - fixture paths under the root and their contents; `undefined` omits a default file.
 * @returns the fixture root and the findings for the written tree.
 */
function lint(files: Fixture) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-spec-lint-'))
  roots.push(root)
  const defaults: Fixture = {
    '.specs/_config.toml': CONFIG,
    '.specs/_project.spec.md': PROJECT,
    '.specs/auth/session-expiry.spec.md': REQUIREMENT,
    '.specs/tasks/expire-sessions.spec.md': TASK,
  }
  for (const [path, content] of Object.entries({ ...defaults, ...files })) {
    if (content === undefined) continue
    const absolute = join(root, path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, content)
  }
  return { root, violations: lintSpecTree(root) }
}

/**
 * Rewrite one frontmatter line of a fixture document.
 * @param source - the document text.
 * @param from - the exact line to replace.
 * @param to - the replacement line.
 * @returns the rewritten document.
 */
function replaceLine(source: string, from: string, to: string): string {
  const lines = source.split('\n')
  const index = lines.indexOf(from)
  if (index === -1) throw new Error(`fixture line not found: ${from}`)
  lines[index] = to
  return lines.join('\n')
}

/** The `file:line  message` diagnostics one tree produces. */
function diagnostics(files: Fixture): string[] {
  return lint(files).violations.map(violation => `${violation.file}:${violation.line}  ${violation.message}`)
}

describe('spec tree lint', () => {
  it('accepts a valid spec tree', () => {
    expect(lint({}).violations).toEqual([])
  })

  it('accepts a TASK in a topical directory that matches its id area', () => {
    expect(lint({
      '.specs/tasks/expire-sessions.spec.md': undefined,
      '.specs/auth/expire-sessions.spec.md': TASK,
    }).violations).toEqual([])
  })

  it('rejects a malformed bare `blocked_by:` key', () => {
    const malformed = replaceLine(TASK, 'blocked_by: []', 'blocked_by:')
    const found = lint({ '.specs/tasks/expire-sessions.spec.md': malformed }).violations
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ file: '.specs/tasks/expire-sessions.spec.md', line: 9 })
    expect(found[0]?.message).toContain('`blocked_by` must be a list of strings')
  })

  it('rejects frontmatter that is not valid YAML', () => {
    const found = lint({ '.specs/tasks/expire-sessions.spec.md': '---\nid: TASK:auth/expire-sessions\n\tbad\n---\n' }).violations
    expect(found.some(violation => violation.message.includes('frontmatter is not valid YAML'))).toBe(true)
  })

  it('rejects a document without frontmatter', () => {
    const found = lint({ '.specs/tasks/expire-sessions.spec.md': '# No frontmatter\n' }).violations
    expect(found).toEqual([{ file: '.specs/tasks/expire-sessions.spec.md', line: 1, message: 'missing YAML frontmatter delimited by `---`' }])
  })

  it('names every missing required field by its line', () => {
    const stripped = TASK
      .replace('summary: Implement bounded session expiry.\n', '')
      .replace('owners: [carlo]\n', '')
      .replace('progress: in-progress\n', '')
      .replace('addresses: ["REQ:auth/session-expiry#c-lifetime"]\n', '')
    const messages = diagnostics({ '.specs/tasks/expire-sessions.spec.md': stripped })
    expect(messages).toEqual(expect.arrayContaining([
      expect.stringContaining('missing required frontmatter field `summary`'),
      expect.stringContaining('missing required frontmatter field `owners`'),
      expect.stringContaining('`task` documents require `progress`'),
      expect.stringContaining('`task` documents require `addresses`'),
    ]))
  })

  it('rejects an empty owners list', () => {
    const found = lint({ '.specs/tasks/expire-sessions.spec.md': replaceLine(TASK, 'owners: [carlo]', 'owners: []') }).violations
    expect(found).toEqual([expect.objectContaining({ message: '`owners` must be a non-empty list of identifiers' })])
  })

  it('rejects a status outside the upstream lifecycle enum', () => {
    const found = lint({ '.specs/tasks/expire-sessions.spec.md': replaceLine(TASK, 'status: accepted', 'status: complete') }).violations
    expect(found).toEqual([expect.objectContaining({
      message: '`status` must be one of draft, accepted, deprecated, superseded; found `complete`',
    })])
  })

  it.each([
    ['completed', 'done'],
    ['complete', 'done'],
    ['doing', 'in-progress'],
    ['in_progress', 'in-progress'],
  ])('rejects the non-canonical progress spelling `%s`', (spelling) => {
    const found = lint({ '.specs/tasks/expire-sessions.spec.md': replaceLine(TASK, 'progress: in-progress', `progress: ${spelling}`) }).violations
    expect(found).toEqual([expect.objectContaining({
      message: `\`progress\` must be one of pending, in-progress, done, blocked, deferred, wontdo; found \`${spelling}\``,
    })])
  })

  it('rejects a requirement level outside the upstream enum', () => {
    const found = lint({ '.specs/auth/session-expiry.spec.md': replaceLine(REQUIREMENT, 'level: MUST', 'level: REQUIRED') }).violations
    expect(found).toEqual([expect.objectContaining({
      message: '`level` must be one of MUST, SHOULD, MAY, INFO; found `REQUIRED`',
    })])
  })

  it('rejects a type whose prefix does not match its id', () => {
    const found = lint({ '.specs/auth/session-expiry.spec.md': replaceLine(REQUIREMENT, 'id: REQ:auth/session-expiry', 'id: IFC:auth/session-expiry') }).violations
    expect(found).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: '`id` must start with `REQ:` for a `requirement` document; found `IFC:auth/session-expiry`' }),
    ]))
  })

  it('rejects an id slug that disagrees with the filename stem', () => {
    const found = lint({ '.specs/tasks/expire-sessions.spec.md': replaceLine(TASK, 'id: TASK:auth/expire-sessions', 'id: TASK:auth/expire-other') }).violations
    expect(found).toEqual([expect.objectContaining({
      message: '`id` slug `expire-other` must equal the filename stem `expire-sessions`',
    })])
  })

  it('rejects a durable document outside its id area directory', () => {
    const misplaced = replaceLine(REQUIREMENT, 'id: REQ:auth/session-expiry', 'id: REQ:auth/session-other')
    const found = lint({ '.specs/tasks/session-other.spec.md': misplaced }).violations
    expect(found).toEqual([expect.objectContaining({
      file: '.specs/tasks/session-other.spec.md',
      message: 'a `requirement` document must live at `.specs/auth/session-other.spec.md` to match its id area; found `.specs/tasks/session-other.spec.md`',
    })])
  })

  it('rejects a TASK outside `.specs/tasks/` whose directory is not its id area', () => {
    const misplaced = replaceLine(TASK, 'id: TASK:auth/expire-sessions', 'id: TASK:auth/expire-other')
    const found = lint({ '.specs/web/expire-other.spec.md': misplaced }).violations
    expect(found).toEqual([expect.objectContaining({
      file: '.specs/web/expire-other.spec.md',
      message: 'a TASK outside `.specs/tasks/` must live in its id area directory `.specs/auth/`; found `.specs/web/`',
    })])
  })

  it('rejects a duplicate document id', () => {
    const found = lint({ '.specs/other/expire-sessions.spec.md': TASK }).violations
    expect(found).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'duplicate id `TASK:auth/expire-sessions`, already declared by `.specs/other/expire-sessions.spec.md`' }),
    ]))
  })

  it('accepts an addresses entry with an existing clause anchor', () => {
    expect(lint({}).violations).toEqual([])
  })

  it('rejects an addresses anchor that no clause declares', () => {
    const found = lint({ '.specs/tasks/expire-sessions.spec.md': replaceLine(TASK, 'addresses: ["REQ:auth/session-expiry#c-lifetime"]', 'addresses: ["REQ:auth/session-expiry#c-missing"]') }).violations
    expect(found).toEqual([expect.objectContaining({
      message: '`addresses` entry `REQ:auth/session-expiry#c-missing` names no `{#c-missing}` anchor in `REQ:auth/session-expiry`',
    })])
  })

  it('resolves an anchor that a typed block id declares', () => {
    const found = lint({ '.specs/tasks/expire-sessions.spec.md': replaceLine(TASK, 'addresses: ["REQ:auth/session-expiry#c-lifetime"]', 'addresses: ["REQ:auth/session-expiry#session-expiry"]') }).violations
    expect(found).toEqual([])
  })

  it('rejects a refines entry that names no document', () => {
    const found = lint({ '.specs/auth/session-expiry.spec.md': replaceLine(REQUIREMENT, 'refines: []', 'refines: [REQ:auth/absent#c-lifetime]') }).violations
    expect(found).toEqual([expect.objectContaining({
      message: '`refines` entry `REQ:auth/absent#c-lifetime` does not resolve to a spec in the tree',
    })])
  })

  it('rejects a blocked_by entry that is not an existing TASK', () => {
    const found = lint({ '.specs/tasks/expire-sessions.spec.md': replaceLine(TASK, 'blocked_by: []', 'blocked_by: ["TASK:auth/absent"]') }).violations
    expect(found).toEqual([expect.objectContaining({
      message: '`blocked_by` entry `TASK:auth/absent` does not resolve to a spec in the tree',
    })])
  })

  it('rejects a blocked_by entry that names a durable specification', () => {
    const found = lint({ '.specs/tasks/expire-sessions.spec.md': replaceLine(TASK, 'blocked_by: []', 'blocked_by: ["REQ:auth/session-expiry"]') }).violations
    expect(found).toEqual([expect.objectContaining({
      message: '`blocked_by` entry `REQ:auth/session-expiry` must name a `task` document; found `requirement`',
    })])
  })

  it('rejects a config baseline outside the version grammar', () => {
    const found = lint({ '.specs/_config.toml': 'baseline = "v0.7"\nproject = "PROJECT:fixture"\n' }).violations
    expect(found).toEqual([expect.objectContaining({
      file: '_config.toml',
      message: '`baseline` must match `forge-spec-v<major>.<minor>.<patch>`; found `v0.7`',
    })])
  })

  it('rejects a config project id that does not resolve', () => {
    const found = lint({ '.specs/_config.toml': 'baseline = "forge-spec-v0.7.0"\nproject = "PROJECT:absent"\n' }).violations
    expect(found).toEqual([expect.objectContaining({
      file: '_config.toml',
      message: '`project` id `PROJECT:absent` does not resolve to a spec in the tree',
    })])
  })

  it('reports a missing config file', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-spec-lint-'))
    roots.push(root)
    mkdirSync(join(root, '.specs'), { recursive: true })
    writeFileSync(join(root, '.specs/_project.spec.md'), PROJECT)
    expect(lintSpecTree(root)).toEqual([{ file: '_config.toml', line: 0, message: 'missing `.specs/_config.toml`' }])
  })
})

describe('spec lint CLI', () => {
  const script = resolve(import.meta.dirname, 'spec-lint.ts')

  const run = (root: string) => spawnSync(process.execPath, ['--import', 'tsx/esm', script, '--root', root], {
    encoding: 'utf8',
    timeout: 120_000,
  })

  it('exits zero and prints nothing for a clean tree', () => {
    const { root } = lint({})
    const result = run(root)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })

  it('exits non-zero with file:line diagnostics for a violating tree', () => {
    const { root } = lint({ '.specs/tasks/expire-sessions.spec.md': replaceLine(TASK, 'progress: in-progress', 'progress: completed') })
    const result = run(root)
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('.specs/tasks/expire-sessions.spec.md:7  `progress` must be one of')
  })
})
