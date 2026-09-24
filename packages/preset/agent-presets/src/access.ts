/** Profile-owned access defaults, validated independently of optional display metadata. @module */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import yaml from 'js-yaml'

/**
 * Read a conversation profile's permission default from access.yml.
 * @param directory - directory containing the profile's composition.
 * @returns a permission-table key, or undefined when the profile inherits the server default.
 * @throws when a present access file is unreadable or malformed.
 */
export async function readPresetAccess(directory: string): Promise<string | undefined> {
  let source: string
  try {
    source = await readFile(join(directory, 'access.yml'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const value: unknown = yaml.load(source)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('access.yml must contain a permissionPreset')
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => key !== 'permissionPreset')
    || typeof record.permissionPreset !== 'string' || record.permissionPreset.trim() === '') {
    throw new Error('access.yml accepts only a non-empty permissionPreset')
  }
  return record.permissionPreset.trim()
}
