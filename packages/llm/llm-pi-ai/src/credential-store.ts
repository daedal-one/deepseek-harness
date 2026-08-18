/**
 * pi-ai credential storage over the Harness credential-reference service.
 * Values remain opaque JSON strings to the shared service; this adapter alone
 * validates and interprets them, while the service supplies atomic durable
 * read-modify-write and never exposes them to configuration clients.
 * @module dsh-llm-pi-ai/credential-store
 */

import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider, CredentialRef } from '@deepseek-ai/dsh-credentials'

/** Prefix separating pi-ai account credentials from user-named API keys. */
const PI_AI_CREDENTIAL_PREFIX = 'DSH_PI_AI_'

/**
 * Durable credential reference for one installed pi-ai provider.
 * @param provider - installed provider id.
 * @returns a shell-safe internal credential reference.
 */
export function piAiCredentialRef(provider: string): CredentialRef {
  return credentialRef(`${PI_AI_CREDENTIAL_PREFIX}${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_AUTH`)
}

/** Whether an unknown value is a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse and validate one stored pi-ai credential at the durable boundary.
 * @param raw - serialized credential, or undefined while absent.
 * @param ref - safe reference name used in diagnostics.
 * @returns the credential or undefined.
 */
function parseCredential(raw: string | undefined, ref: CredentialRef): Credential | undefined {
  if (raw === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`llm-pi-ai: stored account credential ${ref} is not valid JSON; sign out and sign in again`)
  }
  if (!isRecord(parsed)) {
    throw new Error(`llm-pi-ai: stored account credential ${ref} is not an object; sign out and sign in again`)
  }
  if (parsed['type'] === 'oauth') {
    if (typeof parsed['access'] !== 'string' || parsed['access'].length === 0
      || typeof parsed['refresh'] !== 'string' || parsed['refresh'].length === 0
      || typeof parsed['expires'] !== 'number' || !Number.isFinite(parsed['expires'])) {
      throw new Error(`llm-pi-ai: stored OAuth credential ${ref} is incomplete; sign out and sign in again`)
    }
    return parsed as Credential
  }
  if (parsed['type'] === 'api_key') {
    if (parsed['key'] !== undefined && typeof parsed['key'] !== 'string') {
      throw new Error(`llm-pi-ai: stored API-key credential ${ref} is invalid; sign out and sign in again`)
    }
    if (parsed['env'] !== undefined && (!isRecord(parsed['env'])
      || Object.values(parsed['env']).some(value => typeof value !== 'string'))) {
      throw new Error(`llm-pi-ai: stored API-key environment ${ref} is invalid; sign out and sign in again`)
    }
    return parsed as Credential
  }
  throw new Error(`llm-pi-ai: stored account credential ${ref} has an unknown type; sign out and sign in again`)
}

/** pi-ai credential store bridged to the optional Harness credential service. */
export class HarnessPiCredentialStore implements CredentialStore {
  private readonly providers: readonly string[]

  /**
   * @param service - resolves the live credential provider at operation time.
   * @param providers - provider ids this store may enumerate.
   */
  constructor(
    private readonly service: () => CredentialProvider | undefined,
    providers: readonly string[],
  ) {
    this.providers = [...new Set(providers)]
  }

  async read(providerId: string): Promise<Credential | undefined> {
    const credentials = this.service()
    if (credentials === undefined) return undefined
    const ref = piAiCredentialRef(providerId)
    return parseCredential((await credentials.resolve(ref))?.value, ref)
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const entries = await Promise.all(this.providers.map(async (providerId) => {
      const credential = await this.read(providerId)
      return credential === undefined ? undefined : { providerId, type: credential.type }
    }))
    return entries.filter((entry): entry is CredentialInfo => entry !== undefined)
  }

  /**
   * Atomically update one provider credential through the harness store.
   * @param providerId - installed pi-ai provider id.
   * @param update - computes the next structured credential from the current one.
   * @returns the effective credential after the serialized operation.
   */
  async modify(
    providerId: string,
    update: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    const credentials = this.requiredService(providerId)
    const ref = piAiCredentialRef(providerId)
    const stored = await credentials.modify(ref, async (raw) => {
      const next = await update(parseCredential(raw, ref))
      return next === undefined ? undefined : JSON.stringify(next)
    })
    return parseCredential(stored, ref)
  }

  async delete(providerId: string): Promise<void> {
    await this.requiredService(providerId).unset(piAiCredentialRef(providerId))
  }

  /** Resolve the credential service for a write or fail with the user action. */
  private requiredService(providerId: string): CredentialProvider {
    const service = this.service()
    if (service !== undefined) return service
    throw new Error(
      `llm-pi-ai: provider "${providerId}" account authentication requires the credentials service`,
    )
  }
}
