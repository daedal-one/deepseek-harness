/** Explicit operator check of a saved account; never reads a home by default. */
import { copyFile, chmod } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createModels } from '@earendil-works/pi-ai'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { authContextFrom, credentialStoreFrom, migrateLegacyCredentials } from '../src/auth.ts'
import { catalogProvider } from '../src/catalog.ts'

const home = process.env.DSH_CODEX_RECOVERY_HOME
let ctx: Context | undefined
afterEach(async () => { await ctx?.fiber.dispose() })

it.skipIf(home === undefined)('recovers the saved account and persists a real OAuth refresh', { retry: 0, timeout: 60_000 }, async () => {
  const filename = join(home!, '.credentials.yaml')
  const backup = join(home!, `.credentials.codex-recovery-${Date.now()}.backup`)
  await copyFile(filename, backup, constants.COPYFILE_EXCL)
  await chmod(backup, 0o600)
  ctx = new Context()
  await ctx.plugin(LocalCredentialProvider, { path: filename, watch: false })
  await migrateLegacyCredentials(ctx)
  const store = credentialStoreFrom(ctx)
  const before = await store.read('openai-codex')
  if (before?.type !== 'oauth') throw new Error('No saved Codex account is available')
  if (before.expires > Date.now()) throw new Error('The saved access token is still current; refresh was not exercised')
  const models = createModels({ credentials: store, authContext: authContextFrom(ctx) })
  models.setProvider(catalogProvider('openai-codex')!)
  let resolved = false
  try { resolved = (await models.getAuth('openai-codex', { signal: AbortSignal.timeout(45_000) })) !== undefined } catch {
    // Provider failures can echo credential fields; this check reports only the outcome.
    throw new Error('OpenAI refused the saved account refresh; fresh sign-in is required')
  }
  const after = await store.read('openai-codex')
  expect(resolved).toBe(true)
  expect(after?.type === 'oauth' && after.expires > Date.now()).toBe(true)
  expect(after?.type === 'oauth' && after.access !== before.access).toBe(true)
  expect((await ctx.credentials.describe(credentialRef('DSH_PI_AI_OPENAI_CODEX_AUTH'))).configured).toBe(false)
  // Boolean assertions keep the live access and refresh values out of reporter diffs.
})
