import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { Config, resolveProfiles } from '../packages/llm/llm-pi-ai/src/config.ts'
import { loadCordisYaml } from './cordis-yaml.ts'

interface Row { id?: string; config?: Record<string, unknown> }

describe('Daedal OpenAI reference models', () => {
  it('retains saved model ids and resolves the GPT-6 native Codex routes', async () => {
    const source = await readFile(new URL('../docs/reference/daedal/host/cordis.patch.yml', import.meta.url), 'utf8')
    const rows = loadCordisYaml(source) as Row[]
    const config = Config(rows.find(row => row.id === 'llm-pi-ai')?.config)
    const route = resolveProfiles(config.providers).get('openai-codex')
    const models = route?.piProvider?.getModels() ?? []
    expect(models.map(model => model.id)).toEqual(expect.arrayContaining([
      'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna',
    ]))
    for (const id of ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']) {
      expect(models.find(model => model.id === id)).toMatchObject({ id, api: 'openai-codex-responses', input: ['text', 'image'] })
    }
    for (const id of ['gpt-6-sol', 'gpt-6-luna']) {
      expect(models.find(model => model.id === id)).toMatchObject({ contextWindow: 1050000, maxTokens: 128000 })
    }
  })

  it('keeps the OpenAI role tiers on Astra, Sol, and Luna without unsupported minimal effort', async () => {
    const source = await readFile(new URL('../docs/reference/daedal/preset-openai/agent.cordis.yml', import.meta.url), 'utf8')
    expect(() => loadCordisYaml(source)).not.toThrow()
    expect(source).not.toMatch(/gpt-5\.6-|reasoningEffort: minimal/u)
    for (const model of ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']) expect(source).toContain(`model: ${model}`)
  })
})
