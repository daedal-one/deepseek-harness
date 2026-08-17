import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { PluginPackageMetadataResolver } from '../src/metadata.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): { readonly root: string; readonly baseUrl: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-plugin-metadata-'))
  roots.push(root)
  const packageRoot = join(root, 'node_modules', '@fixture', 'metadata-plugin')
  mkdirSync(join(packageRoot, 'feature'), { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    name: '@fixture/metadata-plugin',
    version: '2.4.1',
    description: 'Adds deterministic fixture behavior.',
    author: { name: 'Fixture Author', email: 'private@example.test' },
  }))
  return { root, baseUrl: pathToFileURL(join(root, 'cordis.yml')).href }
}

describe('PluginPackageMetadataResolver', () => {
  it('resolves a package subpath and exposes only display metadata', () => {
    const target = fixture()
    const resolver = new PluginPackageMetadataResolver()
    expect(resolver.resolve('@fixture/metadata-plugin/feature', target.baseUrl)).toEqual({
      author: 'Fixture Author',
      description: 'Adds deterministic fixture behavior.',
      version: '2.4.1',
    })
  })

  it('resolves a relative plugin from its nearest package manifest', () => {
    const target = fixture()
    writeFileSync(join(target.root, 'package.json'), JSON.stringify({
      author: 'Local Author',
      description: 'Runs beside this profile.',
      version: '1.0.0-local',
    }))
    const resolver = new PluginPackageMetadataResolver()
    expect(resolver.resolve('./plugins/local.mjs', target.baseUrl)).toEqual({
      author: 'Local Author',
      description: 'Runs beside this profile.',
      version: '1.0.0-local',
    })
  })

  it('reports unavailable fields for unknown or malformed manifests', () => {
    const target = fixture()
    writeFileSync(join(target.root, 'package.json'), '{ invalid json')
    const resolver = new PluginPackageMetadataResolver()
    expect(resolver.resolve('./local.mjs', target.baseUrl)).toEqual({
      author: null,
      description: null,
      version: null,
    })
    expect(resolver.resolve('cordis:not-installed', target.baseUrl)).toEqual({
      author: null,
      description: null,
      version: null,
    })
  })
})
