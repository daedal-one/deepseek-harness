import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import { composeEntries, initProfile, PROFILES_DIR } from '@deepseek-ai/dsh-app-boot'
import { composeProfile } from '../src/profile-boot.ts'

test('explicit deployment preset roots survive CLI composition; absent roots retain shipped defaults', () => {
  const home = mkdtempSync(join(tmpdir(), 'forge-preset-roots-'))
  vi.stubEnv('DSH_HOME', home)
  try {
    initProfile(join(home, PROFILES_DIR, 'web'), ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    const effective = (patches: string[]) => {
      const c = composeProfile('web', patches)
      return composeEntries([c.bundlePatches, c.profile.patches, c.homePatches, c.overlays]).find(row => row.id === 'agent-presets')?.config as unknown
    }
    expect(effective([])).toMatchObject({ roots: [{ trust: 'system' }] })
    const patch = join(home, 'forge.patch.yml')
    writeFileSync(patch, JSON.stringify([{ id: 'agent-presets', config: { default: 'forge', includeUserRoot: false, roots: [{ path: '/opt/immutable-forge-presets', trust: 'system' }] } }]))
    expect(effective([patch])).toMatchObject({ default: 'forge', includeUserRoot: false, roots: [{ path: '/opt/immutable-forge-presets', trust: 'system' }] })
  } finally { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})
