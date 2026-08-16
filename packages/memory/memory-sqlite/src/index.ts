/** SQLite provider for durable reviewed memory. @module @deepseek-ai/dsh-memory-sqlite */
import { isAbsolute, dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-memory'
import { SqliteMemoryProvider } from './provider.ts'
import { openMemoryDatabase } from './schema.ts'

export const name = 'memory-sqlite'
export const inject = ['memory']
/** SQLite path, retention, and bounded-search deployment policy. */
export interface Config {
  /** Absolute path of the application-owned SQLite database. */
  path: string
  /** Age in days after which rejected or superseded project records are removed. */
  retentionDays?: number
  /** Maximum records returned by one provider query. */
  maxSearchResults?: number
}
export const Config: z<Config> = z.object({
  path: z.string().required(),
  retentionDays: z.number().default(365),
  maxSearchResults: z.number().default(50),
})

/** Open the configured store, register it, and close only after provider removal. */
export function apply(ctx: Context, config: Config): void {
  if (!isAbsolute(config.path)) throw new Error('memory-sqlite: path must be absolute')
  const retentionDays = config.retentionDays ?? 365
  const maxSearchResults = config.maxSearchResults ?? 50
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1) throw new Error('memory-sqlite: retentionDays must be a positive safe integer')
  if (!Number.isSafeInteger(maxSearchResults) || maxSearchResults < 1) throw new Error('memory-sqlite: maxSearchResults must be a positive safe integer')
  mkdirSync(dirname(config.path), { recursive: true })
  const db = openMemoryDatabase(config.path)
  let unregister: (() => void) | undefined
  try {
    unregister = ctx.memory.registerProvider(new SqliteMemoryProvider(db, maxSearchResults, retentionDays))
    const disposeProvider = unregister
    ctx.effect(function* () { yield () => { disposeProvider(); db.close() } }, 'memory-sqlite.close')
  } catch (error: unknown) {
    unregister?.()
    db.close()
    throw error
  }
}

export { SqliteMemoryProvider } from './provider.ts'
export { MEMORY_SQLITE_APPLICATION_ID, SCHEMA_VERSION, openMemoryDatabase } from './schema.ts'
