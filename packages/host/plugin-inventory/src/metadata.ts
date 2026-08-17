/** Resolve display metadata for Loader module specifiers from package manifests. */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, parse } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { PluginPackageMetadata } from './types.ts'

interface PackageManifest {
  readonly author?: unknown
  readonly description?: unknown
  readonly version?: unknown
}

const UNAVAILABLE_METADATA: PluginPackageMetadata = {
  author: null,
  description: null,
  version: null,
}

/** Return a non-empty manifest string, or null when the field is absent or malformed. */
function manifestString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length === 0 ? null : normalized
}

/** Normalize npm's string or object author forms to one display value. */
function manifestAuthor(value: unknown): string | null {
  const direct = manifestString(value)
  if (direct !== null) return direct
  if (typeof value !== 'object' || value === null) return null
  return manifestString((value as { readonly name?: unknown }).name)
}

/** Read only the public display fields from one package manifest. */
function readMetadata(manifestPath: string): PluginPackageMetadata {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest
    return {
      author: manifestAuthor(manifest.author),
      description: manifestString(manifest.description),
      version: manifestString(manifest.version),
    }
  } catch {
    // Optional display metadata must not make a readable Loader inventory fail.
    return UNAVAILABLE_METADATA
  }
}

/** Extract the owning package name from a bare module specifier or subpath. */
function packageNameOf(moduleName: string): string | undefined {
  if (moduleName.startsWith('cordis:')) {
    const builtin = moduleName.slice('cordis:'.length)
    return builtin.length === 0 ? undefined : `@deepseek-ai/cordis-plugin-${builtin}`
  }
  if (moduleName.startsWith('.') || moduleName.startsWith('file:') || isAbsolute(moduleName)) return undefined
  if (/^[a-z][a-z\d+.-]*:/i.test(moduleName)) return undefined
  if (moduleName.startsWith('@')) {
    const [scope, name] = moduleName.split('/')
    return scope !== undefined && name !== undefined ? `${scope}/${name}` : undefined
  }
  const [name] = moduleName.split('/')
  return name === '' ? undefined : name
}

/** Locate a package manifest through Node's lookup order without requiring a package export. */
function bareManifestPath(packageName: string, baseUrl: string | undefined): string | undefined {
  const anchors = baseUrl === undefined ? [import.meta.url] : [baseUrl, import.meta.url]
  for (const anchor of anchors) {
    let require: ReturnType<typeof createRequire>
    try {
      require = createRequire(anchor)
    } catch {
      // A malformed entry-tree base URL cannot identify an installed package.
      continue
    }
    try {
      return require.resolve(`${packageName}/package.json`)
    } catch {
      // Packages need not export package.json; probe the same node_modules roots.
    }
    for (const searchPath of require.resolve.paths(packageName) ?? []) {
      const candidate = join(searchPath, packageName, 'package.json')
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/** Locate the nearest package manifest owning a file-like module specifier. */
function fileManifestPath(moduleName: string, baseUrl: string | undefined): string | undefined {
  if (baseUrl === undefined && !isAbsolute(moduleName) && !moduleName.startsWith('file:')) return undefined
  try {
    const url = isAbsolute(moduleName)
      ? pathToFileURL(moduleName)
      : new URL(moduleName, baseUrl)
    if (url.protocol !== 'file:') return undefined
    const target = fileURLToPath(url)
    let current = existsSync(join(target, 'package.json')) ? target : dirname(target)
    const root = parse(current).root
    while (true) {
      const candidate = join(current, 'package.json')
      if (existsSync(candidate)) return candidate
      if (current === root) return undefined
      current = dirname(current)
    }
  } catch {
    // Invalid or unsupported specifiers have no package metadata projection.
    return undefined
  }
}

/** Process-lifetime resolver for immutable installed-package metadata. */
export class PluginPackageMetadataResolver {
  private readonly cache = new Map<string, PluginPackageMetadata>()

  /**
   * Resolve package metadata for one Loader entry.
   * @param moduleName - exact module specifier stored by the Loader.
   * @param baseUrl - base URL of the entry tree that owns the row.
   * @returns Declared package fields, with null for every unavailable field.
   */
  resolve(moduleName: string, baseUrl: string | undefined): PluginPackageMetadata {
    const cacheKey = `${baseUrl ?? ''}\0${moduleName}`
    const cached = this.cache.get(cacheKey)
    if (cached !== undefined) return cached
    const packageName = packageNameOf(moduleName)
    const manifestPath = packageName === undefined
      ? fileManifestPath(moduleName, baseUrl)
      : bareManifestPath(packageName, baseUrl)
    const metadata = manifestPath === undefined ? UNAVAILABLE_METADATA : readMetadata(manifestPath)
    this.cache.set(cacheKey, metadata)
    return metadata
  }
}
