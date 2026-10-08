/** The Daedal reference must expose model-selected child routes and authorize what its roles already delegate to. */

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { assertAllowedModelRoutes } from '../packages/subagent/tool-subagent/src/model-selection.ts'
import {
  SUBAGENT_MODEL_SELECTION_SETTINGS_SCHEMA,
  type SubagentModelSelectionSettings,
} from '../packages/subagent/tool-subagent/src/model-selection-settings.ts'
import { isCordisGroupEntry, loadCordisYaml } from './cordis-yaml.ts'

interface Row {
  id?: string
  name?: string
  group?: boolean
  config?: unknown
}

const PRESETS = ['preset', 'preset-openai'] as const

/** Narrow an `unknown` YAML node to a plain record. */
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

/** Flatten every Loader entry, including the rows nested in a group's `config` array. */
function rowsOf(source: string): Row[] {
  const entries = loadCordisYaml(source) as Row[]
  const rows: Row[] = []
  const visit = (entry: unknown): void => {
    if (typeof entry !== 'object' || entry === null) return
    rows.push(entry)
    if (isCordisGroupEntry(entry)) for (const child of entry.config) visit(child)
  }
  for (const entry of entries) visit(entry)
  return rows
}

/** Read one preset composition from the reference tree. */
async function presetSource(name: (typeof PRESETS)[number]): Promise<string> {
  return readFile(new URL(`../docs/reference/daedal/${name}/agent.cordis.yml`, import.meta.url), 'utf8')
}

describe('Daedal reference subagent model selection', () => {
  it('enables selection on exactly the primary delegation definition', async () => {
    for (const name of PRESETS) {
      const rows = rowsOf(await presetSource(name))
      const enabled = rows.filter(row => record(row.config)['modelSelectionSettings'] === true)
      expect(enabled.map(row => row.id), name).toEqual(['tool-subagent'])
      expect(record(enabled[0]?.config)['provider'], name).toBe('spawn')
      expect(record(rows.find(row => row.id === 'tool-subagent-fork')?.config), name)
        .not.toHaveProperty('modelSelectionSettings')
    }
  })

  it('authorizes every route the named roles delegate to', async () => {
    const host = rowsOf(await readFile(
      new URL('../docs/reference/daedal/host/cordis.patch.yml', import.meta.url),
      'utf8',
    ))
    // Parsed YAML is an untrusted file boundary, so the schema call is the validation.
    const policy = (
      record(host.find(row => row.id === 'subagent-model-selection-settings')?.config)
    ) as unknown as SubagentModelSelectionSettings
    const parsed = SUBAGENT_MODEL_SELECTION_SETTINGS_SCHEMA(policy)
    expect(parsed.enabled).toBe(true)
    assertAllowedModelRoutes(parsed.allowedModels)
    const allowed = parsed.allowedModels
    expect(allowed.length).toBeGreaterThan(0)
    expect(new Set(allowed.map(route => `${route.provider}\0${route.model}`)).size).toBe(allowed.length)

    const key = (provider: unknown, model: unknown): string => `${String(provider)}\0${String(model)}`
    const authorized = new Set(allowed.map(route => key(route.provider, route.model)))
    for (const name of PRESETS) {
      const rows = rowsOf(await presetSource(name))
      for (const row of rows) {
        if (row.name !== '@deepseek-ai/dsh-tool-subagent') continue
        const options = record(record(row.config)['agentOptions'])
        if (options['provider'] === undefined || options['model'] === undefined) continue
        expect(authorized.has(key(options['provider'], options['model'])), `${name}: ${row.id}`).toBe(true)
      }
    }
  })
})
