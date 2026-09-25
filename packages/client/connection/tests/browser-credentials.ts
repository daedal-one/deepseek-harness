import type { Context } from '@deepseek-ai/cordis'
import type { CredentialKey, CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'

/** Mutable credential-record double for Connection authentication tests. */
export class RecordCredentials {
  record: CredentialRecord | undefined
  discardWrites = false
  reads = 0
  modifies = 0

  readRecord(): Promise<CredentialRecord | undefined> {
    this.reads += 1
    return Promise.resolve(this.record)
  }

  async modifyRecord(
    _key: unknown,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    this.modifies += 1
    const next = await mutate(this.record)
    if (this.discardWrites) return undefined
    if (next !== undefined) this.record = next
    return this.record
  }

  deleteRecord(): Promise<void> {
    this.record = undefined
    return Promise.resolve()
  }
}

/** Keyed record double serializing mutations like the provider contract. */
export class KeyedCredentials {
  readonly records = new Map<CredentialKey, CredentialRecord>()

  readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> { return Promise.resolve(this.records.get(key)) }
  private pending: Promise<unknown> = Promise.resolve()

  modifyRecord: CredentialProvider['modifyRecord'] = (key, mutate) => {
    const result = this.pending.then(async () => {
      const next = await mutate(this.records.get(key))
      if (next !== undefined) this.records.set(key, next)
      return this.records.get(key)
    })
    this.pending = result.then(() => undefined, () => undefined)
    return result
  }
}

/** Provide the record operations Connection needs during authentication setup. */
export function provideBrowserCredentials(ctx: Context): void {
  ctx.provide('credentials', new KeyedCredentials() as unknown as CredentialProvider)
}
