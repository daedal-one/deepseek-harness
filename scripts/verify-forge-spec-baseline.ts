/**
 * Gate: the accepted Forge Spec baseline is one value across the adapter
 * protocol constant, the checked-in spec tree configuration, and the root
 * AGENTS.md format phrase.
 *
 * The adapter must not read `.specs/_config.toml` at runtime because a
 * deployment ships neither the spec tree nor this repository root, so the
 * constant stays the adapter's only authority and this standalone gate keeps
 * the three declarations from drifting apart.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

/** Adapter module that owns the exported baseline constant. */
const PROTOCOL = 'packages/integration/forge-session-adapter/src/protocol.ts'
/** Spec tree configuration that declares the format baseline. */
const CONFIG = '.specs/_config.toml'
/** Root instructions that name the Specs Format version in prose. */
const AGENTS = 'AGENTS.md'

/**
 * Read one repository file as UTF-8.
 * @param relative - Repository-relative path.
 * @returns The file contents.
 */
function read(relative: string): string {
  return readFileSync(resolve(root, relative), 'utf8')
}

/**
 * Normalize a version into the stored document format name.
 * @param version - Version digits captured from one declaration.
 * @returns The canonical `forge-spec-vX.Y.Z` baseline.
 */
function normalize(version: string): string {
  const parts = version.split('.')
  while (parts.length < 3) parts.push('0')
  return `forge-spec-v${parts.join('.')}`
}

/**
 * Extract the version a declaration carries.
 * @param source - File contents to search.
 * @param pattern - Pattern whose first capture group holds the version digits.
 * @param relative - Repository-relative path named in the failure message.
 * @returns The normalized baseline, or a failure exit when the pattern is absent.
 */
function declared(source: string, pattern: RegExp, relative: string): string {
  const version = pattern.exec(source)?.[1]
  if (version === undefined) {
    console.error(`verify-forge-spec-baseline: ${relative} declares no Forge Spec baseline.`)
    process.exit(1)
  }
  return normalize(version)
}

/** Run the baseline consistency audit as a standalone doc-sync gate. */
function main(): void {
  const adapter = declared(read(PROTOCOL), /FORGE_SPEC_BASELINE\s*=\s*'forge-spec-v([0-9]+(?:\.[0-9]+)*)'/, PROTOCOL)
  const specs = declared(read(CONFIG), /^baseline\s*=\s*"forge-spec-v([0-9]+(?:\.[0-9]+)*)"/m, CONFIG)
  const agents = declared(read(AGENTS), /Specs Format v([0-9]+(?:\.[0-9]+)*)/, AGENTS)

  const failures: string[] = []
  if (specs !== adapter) failures.push(`${CONFIG} declares ${specs}; ${PROTOCOL} declares ${adapter}`)
  if (agents !== adapter) failures.push(`${AGENTS} declares ${agents}; ${PROTOCOL} declares ${adapter}`)

  if (failures.length > 0) {
    console.error('verify-forge-spec-baseline: Forge Spec baseline mismatch:')
    for (const failure of failures) console.error(`  ${failure}`)
    process.exit(1)
  }

  console.log(`verify-forge-spec-baseline: ${adapter} agrees across ${PROTOCOL}, ${CONFIG}, and ${AGENTS}.`)
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) main()
