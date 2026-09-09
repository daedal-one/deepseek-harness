/** The shared layer must disable the complete model-facing base set exactly once and mount one roster. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

const MODEL_FACING_ROWS = [
  'tool-bash', 'tool-pwsh', 'tool-jobs', 'tool-fs', 'tool-fs-search',
  'skill-filesystem', 'tool-skill', 'command-goal', 'tool-goal',
  'plan-mode', 'compaction-basic', 'command-compact', 'tool-result-pruner',
  'tool-subagent-control', 'tool-subagent-list-agents', 'tool-subagent',
  'tool-subagent-fork', 'workflow-worker-thread', 'tool-workflow', 'tool-ralph',
  'agent-instructions', 'tool-todo', 'tool-web',
] as const

describe('agent-plane bundle', () => {
  it('owns the common preset boundary', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as { id?: string; disabled?: boolean; insert?: { id?: string; name?: string }[] }[]
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    for (const id of MODEL_FACING_ROWS) {
      expect(parsed.filter(row => row.id === id && row.disabled === true), id).toHaveLength(1)
    }
    expect(parsed.flatMap(row => row.insert ?? [])).toEqual([{
      id: 'subagent-model-selection-settings', name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings',
    }, {
      id: 'agent-presets', name: '@deepseek-ai/dsh-agent-presets', config: { default: 'standard' },
    }])
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-agent-presets')
  })
})
