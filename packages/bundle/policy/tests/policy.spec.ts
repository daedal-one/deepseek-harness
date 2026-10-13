/**
 * The bundle's substance is its patch file: the `dsh.bundle.patch` manifest
 * field must name a real, parseable patch list, every declared row must be
 * resolvable from this bundle's own dependencies, and only the decision
 * service may be active.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { Config as EnforcerConfig } from '@deepseek-ai/dsh-tool-policy-enforcer'
import type { Config as EnforcerConfigShape } from '@deepseek-ai/dsh-tool-policy-enforcer'
import { Config as McpConfig } from '@deepseek-ai/dsh-tool-policy-mcp'
import type { Config as McpConfigShape } from '@deepseek-ai/dsh-tool-policy-mcp'
import { Config as ShellConfig } from '@deepseek-ai/dsh-tool-policy-shell'
import type { Config as ShellConfigShape } from '@deepseek-ai/dsh-tool-policy-shell'

/** One row as the manifest test reads it. */
interface DeclaredRow {
  id?: string
  name?: string
  disabled?: boolean
  config?: Record<string, unknown>
}

const root = fileURLToPath(new URL('..', import.meta.url))

/** Read the declared rows of the patch named by the `dsh.bundle.patch` field. */
function declaredRows(): DeclaredRow[] {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
    dsh?: { bundle?: { patch?: string } }
  }
  const patch = manifest.dsh?.bundle?.patch
  if (patch === undefined) throw new Error('package.json must declare dsh.bundle.patch')
  const parsed = yaml.load(readFileSync(resolve(root, patch), 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new TypeError('the policy patch must parse to a patch list')
  return parsed.flatMap((entry): DeclaredRow[] =>
    typeof entry === 'object' && entry !== null
      ? (entry as { insert?: DeclaredRow[] }).insert ?? []
      : [])
}

describe('dsh-policy bundle', () => {
  it('declares a parseable patch list whose rows resolve from its own dependencies', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const rows = declaredRows()
    expect(rows.map(row => row.id)).toEqual([
      'tool-policy',
      'tool-policy-enforcer',
      'tool-policy-shell',
      'tool-policy-mcp',
    ])
    // Per-layer resolution anchors on the bundle package directory, so a
    // declared row's package must be a dependency of this bundle.
    for (const row of rows) {
      expect(row.name, `${String(row.id)} must name a package`).toBeDefined()
      expect(manifest.dependencies).toHaveProperty(row.name as string)
    }
  })

  it('mounts only the decision service and declares every other row disabled', () => {
    const rows = declaredRows()
    expect(rows.filter(row => row.disabled !== true).map(row => row.id)).toEqual(['tool-policy'])
    // A live enforcer with no registered provider denies every agent tool call,
    // so the enforcement row is declared with the conservative threshold and
    // the two providers are declared without a config.
    expect(rows.find(row => row.id === 'tool-policy-enforcer')).toMatchObject({
      disabled: true,
      config: { approvalThreshold: 3 },
    })
    for (const id of ['tool-policy-shell', 'tool-policy-mcp']) {
      const row = rows.find(candidate => candidate.id === id)
      expect(row?.disabled).toBe(true)
      expect(row?.config).toBeUndefined()
    }
  })

  it('ships only configurations the owning package accepts', () => {
    const rows = declaredRows()
    const enforcerConfig = rows.find(row => row.id === 'tool-policy-enforcer')?.config
    expect(enforcerConfig).toBeDefined()
    // The declared config is what the package's own schema resolves, so enabling
    // the row needs only `disabled: false` in the deployment's patch layer.
    expect(EnforcerConfig(enforcerConfig as EnforcerConfigShape)).toMatchObject({ approvalThreshold: 3 })
    // Both providers reject an empty config, so enabling either row as declared
    // fails loud at load instead of mounting a policy with no rules.
    expect(() => ShellConfig({} as ShellConfigShape)).toThrow()
    expect(() => McpConfig({} as McpConfigShape)).toThrow()
  })
})
