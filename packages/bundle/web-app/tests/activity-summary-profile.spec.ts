import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('Web activity-summary profile', () => {
  it('pins the bounded auxiliary route and declares its package dependency', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const parsed = yaml.load(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'), {
      schema: entryListSchema,
    })
    if (!Array.isArray(parsed)) throw new TypeError('Web patch must parse to a patch list')
    const rows = parsed.flatMap((patch): Record<string, unknown>[] =>
      typeof patch === 'object' && patch !== null
        ? (patch as { insert?: Record<string, unknown>[] }).insert ?? []
        : [])

    expect(rows.find(row => row.id === 'session-activity-summary')).toMatchObject({
      name: '@deepseek-ai/dsh-session-activity-summary-llm',
      config: {
        operationsPerSummary: 5,
        maxLines: 3,
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4.1-flash',
      },
    })
    expect(manifest.dependencies)
      .toHaveProperty('@deepseek-ai/dsh-session-activity-summary-llm', 'workspace:^')
  })
})
