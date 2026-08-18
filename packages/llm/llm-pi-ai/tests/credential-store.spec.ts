import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { HarnessPiCredentialStore, piAiCredentialRef } from '../src/credential-store.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function harness(): Promise<{ ctx: Context; store: HarnessPiCredentialStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pi-credentials-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const ctx = new Context()
  const fiber = ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  cleanups.push(() => fiber.dispose())
  await fiber
  return {
    ctx,
    store: new HarnessPiCredentialStore(() => ctx.get('credentials'), ['openai-codex']),
  }
}

function oauth(expires: number): OAuthCredential {
  return { type: 'oauth', access: 'access-token', refresh: 'refresh-token', expires, accountId: 'account' }
}

describe('HarnessPiCredentialStore', () => {
  it('persists typed pi-ai credentials and lists metadata without values', async () => {
    const { ctx, store } = await harness()
    await expect(store.modify('openai-codex', () => Promise.resolve(oauth(10))))
      .resolves.toEqual(oauth(10))
    await expect(store.read('openai-codex')).resolves.toEqual(oauth(10))
    await expect(store.list()).resolves.toEqual([{ providerId: 'openai-codex', type: 'oauth' }])

    const raw = await ctx.credentials.resolve(piAiCredentialRef('openai-codex'))
    expect(raw?.source).toBe('file')
    expect(JSON.parse(raw?.value ?? '')).toEqual(oauth(10))
    await store.delete('openai-codex')
    await expect(store.read('openai-codex')).resolves.toBeUndefined()
  })

  it('serializes concurrent refresh mutations through the credential service', async () => {
    const { store } = await harness()
    await store.modify('openai-codex', () => Promise.resolve(oauth(0)))
    const refresh = async (current: import('@earendil-works/pi-ai').Credential | undefined): Promise<OAuthCredential> => {
      if (current?.type !== 'oauth') throw new Error('missing oauth credential')
      await Promise.resolve()
      return { ...current, expires: current.expires + 1 }
    }

    const refreshed = await Promise.all([
      store.modify('openai-codex', refresh),
      store.modify('openai-codex', refresh),
    ])

    expect(refreshed.map(credential => credential?.type === 'oauth' ? credential.expires : -1).sort())
      .toEqual([1, 2])
    await expect(store.read('openai-codex')).resolves.toMatchObject({ expires: 2 })
  })

  it('fails loud on invalid durable data without quoting the stored value', async () => {
    const { ctx, store } = await harness()
    await ctx.credentials.set(piAiCredentialRef('openai-codex'), 'not-json-secret')
    const read = store.read('openai-codex')
    await expect(read).rejects.toThrow(/not valid JSON/)
    await expect(read).rejects.not.toThrow(/not-json-secret/)
  })

  it('requires the shared credential service for writes', async () => {
    const store = new HarnessPiCredentialStore(() => undefined, ['openai-codex'])
    await expect(store.read('openai-codex')).resolves.toBeUndefined()
    await expect(store.modify('openai-codex', () => Promise.resolve(oauth(1))))
      .rejects.toThrow(/requires the credentials service/)
  })
})
