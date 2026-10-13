import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { expect, it } from 'vitest'
import * as Bundle from '../src/index.ts'

it('keeps the named bundle plugin intact and its preset out of the ordinary shipped roster', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(Loader)
    expect(ctx.loader.unwrapExports(Bundle)).toBe(Bundle)
    expect('default' in Bundle).toBe(false)
    const mounted = await ctx.plugin(Bundle)
    await mounted.dispose()
    expect(existsSync(fileURLToPath(new URL('../presets/deadal-intellect/preset.yml', import.meta.url)))).toBe(true)
    expect(existsSync(fileURLToPath(new URL('../../../preset/agent-presets/presets/deadal-intellect', import.meta.url)))).toBe(false)
  } finally { await ctx.fiber.dispose() }
})
