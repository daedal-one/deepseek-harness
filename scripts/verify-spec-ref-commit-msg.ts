/**
 * Enforce the commit-trailer convention for behavior-changing commits: a
 * subject carrying a `feat`, `fix`, or `perf` conventional prefix needs a
 * `Spec-Ref:` body trailer naming a declared spec id, or
 * `Spec-Ref: none (<reason>)` when no spec applies. Merge commits and every
 * other conventional prefix are exempt from the trailer requirement. Real
 * references resolve against the `id:` frontmatter of the spec files under
 * `.specs/`; an unresolvable one fails with the closest declared ids so a typo
 * stays fixable. lefthook `commit-msg` invokes this with the commit message
 * file path as the first argument.
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Repository root, resolved from this script's location in `scripts/`. */
const ROOT = resolve(import.meta.dirname, '..')

/** Conventional prefixes whose commits must name a spec or the none reason. */
const GATED_PREFIXES = new Set(['feat', 'fix', 'perf'])

/** Subject grammar: a lowercase type, an optional scope, an optional `!`, then `:`. */
const SUBJECT_PREFIX = /^([a-z]+)(?:\([^)]*\))?!?:/

/** Trailer grammar: the reference first, then whatever else the line carries. */
const TRAILER = /^Spec-Ref: (\S+)(.*)$/

/** The none form's parenthesized reason, which must hold something. */
const NONE_WITH_REASON = /^\s*\(\s*\S.*\)\s*$/

/** Maximum closest-id suggestions named by one unresolvable reference. */
const MAX_SUGGESTIONS = 3

/**
 * Read the `id:` value declared by one spec file's YAML frontmatter.
 * @param text - the complete spec file contents.
 * @returns the declared id, or undefined when the file declares none.
 */
function frontmatterId(text: string): string | undefined {
  if (!text.startsWith('---')) return undefined
  const end = text.indexOf('\n---', 3)
  const block = end === -1 ? text : text.slice(0, end)
  return /^id:[ \t]*(\S+)[ \t]*$/m.exec(block)?.[1]
}

/**
 * Collect every spec id declared under `root`.
 * @param root - absolute repository root holding `.specs/`.
 * @returns the sorted, de-duplicated declared ids.
 */
export function collectSpecIds(root: string): string[] {
  const ids = new Set<string>()
  for (const relativePath of globSync('.specs/**/*.spec.md', { cwd: root })) {
    const id = frontmatterId(readFileSync(resolve(root, relativePath), 'utf8'))
    if (id !== undefined) ids.add(id)
  }
  return [...ids].sort((left, right) => left.localeCompare(right))
}

/**
 * Measure the single-character edit distance between two ids.
 * @param left - first id.
 * @param right - second id.
 * @returns the minimum number of insertions, deletions, and substitutions.
 */
function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= right.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (left[i - 1] === right[j - 1] ? 0 : 1)
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution)
    }
    previous = current
  }
  return previous[right.length] ?? 0
}

/**
 * Name the declared ids closest to an unresolvable reference.
 * @param reference - the id the commit named.
 * @param ids - every id declared under `.specs/`.
 * @returns up to `MAX_SUGGESTIONS` nearest ids, nearest first.
 */
export function closestSpecIds(reference: string, ids: readonly string[]): string[] {
  return [...ids]
    .map(id => ({ id, distance: editDistance(reference, id) }))
    .sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id))
    .slice(0, MAX_SUGGESTIONS)
    .map(entry => entry.id)
}

/**
 * Decide whether one commit message satisfies the trailer convention.
 * @param message - the complete commit message text.
 * @param specIds - every id declared under `.specs/`.
 * @returns actionable failure text, or null when the message passes.
 */
export function checkCommitMessage(message: string, specIds: readonly string[]): string | null {
  const lines = message.split('\n').map(line => line.trimEnd())
  const subject = lines.find(line => line.trim() !== '' && !line.startsWith('#'))?.trim()
  if (subject === undefined || subject.startsWith('Merge ')) return null
  const prefix = SUBJECT_PREFIX.exec(subject)?.[1]
  if (prefix === undefined || !GATED_PREFIXES.has(prefix)) return null

  const trailer = lines.map(line => TRAILER.exec(line)).find(match => match !== null)
  if (trailer == null) {
    return `subject starts with \`${prefix}\` but the message has no \`Spec-Ref:\` trailer.\n`
      + 'Add `Spec-Ref: <id>` naming the accepted spec for this change, or `Spec-Ref: none (<reason>)` when no spec applies.'
  }
  const reference = trailer[1] ?? ''
  const remainder = trailer[2] ?? ''
  if (reference === 'none') {
    if (!NONE_WITH_REASON.test(remainder)) {
      return '`Spec-Ref: none` needs a non-empty reason, for example `Spec-Ref: none (mechanical extraction only)`.'
    }
    return null
  }

  const base = reference.split('#')[0] ?? reference
  if (specIds.includes(base)) return null
  const suggestions = closestSpecIds(base, specIds)
  const hint = suggestions.length === 0 ? '' : `\nClosest declared ids: ${suggestions.join(', ')}.`
  return `\`Spec-Ref: ${reference}\` does not match any id declared under \`.specs/\`.${hint}\n`
    + 'Name a declared id exactly, or use `Spec-Ref: none (<reason>)` when no spec applies.'
}

/**
 * Check the commit message stored in a file.
 * @param filePath - path to the commit message file.
 * @param specIds - every id declared under `.specs/`.
 * @returns actionable failure text, or null when the message passes.
 */
export function checkCommitMessageFile(filePath: string, specIds: readonly string[]): string | null {
  return checkCommitMessage(readFileSync(filePath, 'utf8'), specIds)
}

/**
 * Run the gate for lefthook, reading the message file named by argv.
 * @returns the process exit code: 0 on pass, 1 on violation, 2 on usage or read failure.
 */
function main(): number {
  const messageFile = process.argv[2]
  if (messageFile === undefined) {
    console.error('verify-spec-ref-commit-msg: expected the commit message file path as the first argument.')
    return 2
  }
  let problem: string | null = null
  try {
    problem = checkCommitMessageFile(resolve(messageFile), collectSpecIds(ROOT))
  } catch (error) {
    console.error(`verify-spec-ref-commit-msg: cannot read ${messageFile}: ${(error as Error).message}`)
    return 2
  }
  if (problem === null) return 0
  console.error(`verify-spec-ref-commit-msg: ${problem}`)
  return 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main())
}
