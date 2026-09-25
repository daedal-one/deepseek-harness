/** Durable Host correlation and application-root activation ownership. */
import { randomUUID } from 'node:crypto'
import { credentialKey, type CredentialProvider, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { connectionIdentitySchema, storedHostIdentitySchema, type ConnectionIdentity } from './host-identity-protocol.ts'

const HOST_IDENTITY_KEY = credentialKey('client-connection', 'host-identity')
const roots = new WeakMap<object, ConnectionIdentity>()

function readStored(record: CredentialRecord | undefined): ReturnType<typeof storedHostIdentitySchema.parse> {
  if (record?.kind !== 'grant') {
    throw new Error('client-connection: host-identity grant record is missing or has the wrong kind')
  }
  const parsed = storedHostIdentitySchema.safeParse(record.payload)
  if (!parsed.success) throw new Error('client-connection: invalid host-identity grant payload')
  return parsed.data
}

/**
 * Load or atomically create a durable Host id before publishing a Connection.
 * A root cannot silently change identity after its credential record changes.
 * @param owner - application root retaining its activation across plugin reloads.
 * @param credentials - provider serializing record initialization and persistence.
 * @returns durable Host id and root-owned activation id after successful persistence.
 */
export async function createHostIdentity(
  owner: object,
  credentials: Pick<CredentialProvider, 'modifyRecord'>,
): Promise<ConnectionIdentity> {
  const record = await credentials.modifyRecord(HOST_IDENTITY_KEY, (current) => {
    const previous = roots.get(owner)
    if (current !== undefined) {
      const stored = readStored(current)
      if (previous !== undefined && stored.hostId !== previous.hostId) {
        throw new Error('client-connection: host identity changed within one application root')
      }
      return Promise.resolve(undefined)
    }
    if (previous !== undefined) {
      throw new Error('client-connection: host-identity record was removed from an active application root')
    }
    return Promise.resolve({ kind: 'grant', payload: { version: 1, hostId: randomUUID() } })
  })
  const stored = readStored(record)
  const previous = roots.get(owner)
  if (previous !== undefined) {
    if (stored.hostId !== previous.hostId) {
      throw new Error('client-connection: host identity changed within one application root')
    }
    return previous
  }
  const identity = Object.freeze(connectionIdentitySchema.parse({ ...stored, activationId: randomUUID() }))
  roots.set(owner, identity)
  return identity
}
