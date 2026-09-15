/** Persistence and application-root lifetime of Host correlation values. */
import { describe, expect, it } from 'vitest'
import { credentialKey, type CredentialProvider, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { createHostIdentity } from '../src/host-identity.ts'
import { connectionIdentitySchema } from '../src/host-identity-protocol.ts'
import { KeyedCredentials } from './browser-credentials.ts'

const key = credentialKey('client-connection', 'host-identity')
const replacementId = '26e99520-f2d3-4874-84b5-07c5ef24775d'

describe('Host identity', () => {
  it('retains Host identity across roots and activation identity across reloads', async () => {
    const credentials = new KeyedCredentials()
    const root = {}
    const first = await createHostIdentity(root, credentials)
    expect(connectionIdentitySchema.safeParse(first).success).toBe(true)
    expect(await createHostIdentity(root, credentials)).toEqual(first)
    const next = await createHostIdentity({}, credentials)
    expect(next.hostId).toBe(first.hostId)
    expect(next.activationId).not.toBe(first.activationId)
    expect(credentials.records.get(key)).toEqual({ kind: 'grant', payload: { version: 1, hostId: first.hostId } })
  })

  it('serializes concurrent first activations onto one persisted Host id', async () => {
    const credentials = new KeyedCredentials()
    const identities = await Promise.all(Array.from({ length: 8 }, () => createHostIdentity({}, credentials)))
    expect(new Set(identities.map(value => value.hostId)).size).toBe(1)
    expect(new Set(identities.map(value => value.activationId)).size).toBe(8)
  })

  it('keeps simultaneous reloads of one root on one activation', async () => {
    const root = {}
    const credentials = new KeyedCredentials()
    const identities = await Promise.all([createHostIdentity(root, credentials), createHostIdentity(root, credentials)])
    expect(identities[0]).toEqual(identities[1])
  })

  it('isolates separate credential stores and detects concurrent provider replacement', async () => {
    const first = await createHostIdentity({}, new KeyedCredentials())
    const second = await createHostIdentity({}, new KeyedCredentials())
    expect(first.hostId).not.toBe(second.hostId)
    const root = {}
    const attempts = await Promise.allSettled([
      createHostIdentity(root, new KeyedCredentials()), createHostIdentity(root, new KeyedCredentials()),
    ])
    expect(attempts.map(value => value.status).sort()).toEqual(['fulfilled', 'rejected'])
    const failed = attempts.find(value => value.status === 'rejected')
    expect(failed).toMatchObject({ reason: new Error('client-connection: host identity changed within one application root') })
  })

  it.each([
    { kind: 'invalid', payload: {} },
    { kind: 'grant', payload: null },
    { kind: 'grant', payload: { version: 2, hostId: replacementId } },
    { kind: 'grant', payload: { version: 1, hostId: 'not-an-id' } },
    { kind: 'grant', payload: { version: 1, hostId: replacementId.toUpperCase() } },
    { kind: 'grant', payload: { version: 1, hostId: replacementId, secret: 'unexpected' } },
  ])('refuses invalid stored records without replacing them: %j', async (record) => {
    const credentials = new KeyedCredentials()
    credentials.records.set(key, record as CredentialRecord)
    await expect(createHostIdentity({}, credentials)).rejects.toThrow(/host-identity/)
    expect(credentials.records.get(key)).toBe(record)
  })

  it('refuses deletion and replacement within an active root', async () => {
    const credentials = new KeyedCredentials()
    const root = {}
    await createHostIdentity(root, credentials)
    credentials.records.delete(key)
    await expect(createHostIdentity(root, credentials)).rejects.toThrow(/removed/)
    expect(credentials.records.has(key)).toBe(false)
    credentials.records.set(key, { kind: 'grant', payload: { version: 1, hostId: replacementId } })
    await expect(createHostIdentity(root, credentials)).rejects.toThrow(/changed/)
  })

  it('publishes nothing when persistence fails or discards the write', async () => {
    const failure = new Error('storage unavailable')
    const failing: Pick<CredentialProvider, 'modifyRecord'> = { modifyRecord: () => Promise.reject(failure) }
    const discarding: Pick<CredentialProvider, 'modifyRecord'> = {
      async modifyRecord(_key, mutate) { await mutate(undefined); return undefined },
    }
    const root = {}
    await expect(createHostIdentity(root, failing)).rejects.toBe(failure)
    await expect(createHostIdentity(root, discarding)).rejects.toThrow(/missing/)
    await expect(createHostIdentity(root, new KeyedCredentials())).resolves.toMatchObject({ version: 1 })
  })
})
