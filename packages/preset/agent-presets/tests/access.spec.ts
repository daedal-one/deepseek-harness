import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { readPresetAccess } from '../src/access.ts'

it('inherits the server default only when access.yml is absent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'preset-access-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  expect(await readPresetAccess(directory)).toBeUndefined()
  await writeFile(join(directory, 'access.yml'), 'permissionPreset: policy-reviewed\n')
  expect(await readPresetAccess(directory)).toBe('policy-reviewed')
})

it.each(['', '[]', 'permissionPreset: 7', 'permissionPreset: " "', 'permissionPreset: [', 'permissionPreset: read-only\nextra: true'])('refuses invalid access configuration: %s', async (source) => {
  const directory = await mkdtemp(join(tmpdir(), 'preset-access-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  await writeFile(join(directory, 'access.yml'), source)
  await expect(readPresetAccess(directory)).rejects.toThrow()
})
