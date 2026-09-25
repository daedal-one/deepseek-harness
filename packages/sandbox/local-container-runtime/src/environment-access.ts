/** Durable environment grants and revision-checked repository credential issuance. @module */
import { brandString } from '@deepseek-ai/dsh-brand'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { gitAuthorization, validateGitRemote } from './git-authorization.ts'
import { publishWorkspaceJson, readWorkspaceJson } from './workspace-git.ts'
import type { EnvironmentAccessConfig, EnvironmentAccessRecord, EnvironmentId, EnvironmentRepository, RepositoryAccess, RepositoryApproval, RepositoryGrant } from './environment-types.ts'

/** Environment authority owned by a supervisor holding the environment's exclusive storage lease. */
export class EnvironmentAccess {
  private record: EnvironmentAccessRecord
  private mutation: Promise<void> = Promise.resolve()
  private readonly credentials = new Map<number, () => Promise<string[]>>()

  private constructor(
    readonly config: EnvironmentAccessConfig,
    private readonly path: string,
    private readonly maxBytes: number,
    record: EnvironmentAccessRecord,
  ) {
    this.record = record
  }

  /** Load durable grants; initial configuration cannot restore revoked authority on restart.
   * @param config - operator-owned environment identity and repository catalog.
   * @param directory - leased, owner-only environment recovery directory.
   * @param maxBytes - complete serialized grant-store bound.
   * @returns the current environment authority.
   */
  static async open(config: EnvironmentAccessConfig, directory: string, maxBytes: number): Promise<EnvironmentAccess> {
    validateConfig(config)
    const path = join(directory, 'environment-access.json')
    let record: EnvironmentAccessRecord
    try { record = parseRecord(await readWorkspaceJson(path, maxBytes), config) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const now = Date.now()
      record = { version: 1, environmentId: brandString<EnvironmentId>(config.id), revision: config.initialGrants.length,
        grants: config.initialGrants.map((grant, index) => ({ ...grant, revision: index + 1, approvedAt: now, expiresAt: now + config.grantLifetimeMs, approval: { kind: 'deployment' } })), history: [] }
      record.history = record.grants.map(grant => ({ kind: 'grant', grant }))
      await publishWorkspaceJson(path, record, maxBytes)
    }
    return new EnvironmentAccess(config, path, maxBytes, record)
  }

  /** Current revision for compare-and-set approval and model-visible authority. */
  get revision(): number { return this.record.revision }
  /** Stable identity owned by the durable environment record. */
  get id(): EnvironmentId { return this.record.environmentId }

  /** Resolve a catalog checkout or an allowed remote with an environment-owned destination.
   * @param repository - exact canonical repository URL.
   * @returns the trusted import source and credential issuers.
   */
  repository(repository: string): EnvironmentRepository & { clone: boolean } {
    const entry = this.config.repositories.find(candidate => candidate.url === repository)
    if (entry !== undefined) return { ...entry, clone: false }
    const remote = this.config.remoteRepositories
    if (remote === undefined) throw new Error('repository is not in this environment’s requestable catalog')
    const source = join(dirname(this.path), 'repositories', createHash('sha256').update(repository).digest('hex'))
    const url = validateGitRemote({ source, url: repository, credentialTimeoutMs: remote.credentialTimeoutMs })
    const provider = remote.providers.find(candidate => candidate.origin === url.origin)
    return { source, url: repository, credentialTimeoutMs: remote.credentialTimeoutMs, ...provider, clone: true }
  }

  /** Find active authority; push includes fetch.
   * @param repository - canonical repository URL.
   * @param access - required remote operation.
   * @returns a copy of the sufficient grant, if any.
   */
  grant(repository: string, access: RepositoryAccess): RepositoryGrant | undefined {
    const grant = this.record.grants.find(candidate => candidate.repository === repository && candidate.expiresAt > Date.now()
      && (candidate.access === 'push' || access === 'fetch'))
    return grant === undefined ? undefined : structuredClone(grant)
  }

  /** Commit an explicit user decision only against the revision shown for approval.
   * @param repository - catalog repository covered by the decision.
   * @param access - approved operation scope.
   * @param approval - durable reference to the explicit user decision.
   * @param expectedRevision - authority revision displayed when asking.
   * @param signal - cancellation checked before the durable commit begins.
   * @returns the committed grant; stale decisions never overwrite newer authority.
   */
  async approve(repository: string, access: RepositoryAccess, approval: RepositoryApproval & { kind: 'user' }, expectedRevision: number, signal: AbortSignal): Promise<RepositoryGrant> {
    this.repository(repository)
    return await this.change(async () => {
      signal.throwIfAborted()
      if (this.record.revision !== expectedRevision) throw new Error('environment access changed while approval was pending; request access again')
      const now = Date.now()
      const grant: RepositoryGrant = { repository, access, revision: this.record.revision + 1,
        approvedAt: now, expiresAt: now + this.config.grantLifetimeMs, approval: structuredClone(approval) }
      await this.publish({ ...this.record,
        revision: grant.revision,
        history: [...this.record.history, { kind: 'grant', grant }],
        grants: [...this.record.grants.filter(candidate => candidate.repository !== repository), grant] })
      return structuredClone(grant)
    })
  }

  /** Revoke new issuance; credentials already given to a process expire within one hour.
   * @param repository - repository whose current grant is removed.
   * @param expectedRevision - current authority revision observed by the caller.
   */
  async revoke(repository: string, expectedRevision: number): Promise<void> {
    this.repository(repository)
    await this.change(async () => {
      if (this.record.revision !== expectedRevision) throw new Error('environment access changed before revocation')
      const revokedAt = Date.now()
      await this.publish({ ...this.record,
        revision: this.record.revision + 1,
        history: [...this.record.history, { kind: 'revoke', repository, revision: this.record.revision + 1,
          revokedAt, credentialsExpireBy: revokedAt + 3_600_000 }],
        grants: this.record.grants.filter(candidate => candidate.repository !== repository) })
    })
  }

  /** Authorize a new sandbox process using current environment grants.
   * @returns Git URL-scoped environment entries; an in-flight revoked response is discarded.
   */
  async authorize(): Promise<string[]> {
    const revision = this.record.revision
    const entries: Array<[string, string]> = [['credential.helper', '']]
    for (const grant of this.record.grants) {
      if (grant.expiresAt <= Date.now()) continue
      const repository = this.repository(grant.repository)
      const command = grant.access === 'push' ? repository.pushCredentialCommand : repository.fetchCredentialCommand
      if (command === undefined) continue
      let authorize = this.credentials.get(grant.revision)
      if (authorize === undefined) {
        authorize = gitAuthorization({ source: repository.source,
          url: repository.url,
          credentialCommand: command,
          credentialTimeoutMs: repository.credentialTimeoutMs })
        this.credentials.set(grant.revision, authorize)
      }
      const environment = await authorize()
      if (this.record.revision !== revision || grant.expiresAt <= Date.now()) throw new Error('environment access changed during credential issuance; retry the operation')
      const key = environment.find(entry => entry.startsWith('GIT_CONFIG_KEY_0='))?.slice('GIT_CONFIG_KEY_0='.length)
      const value = environment.find(entry => entry.startsWith('GIT_CONFIG_VALUE_0='))?.slice('GIT_CONFIG_VALUE_0='.length)
      if (key === undefined || value === undefined) throw new Error('repository credential issuer returned no URL-scoped authorization')
      entries.push([key, value])
    }
    return [`GIT_CONFIG_COUNT=${entries.length}`, ...entries.flatMap(([key, value], index) => [`GIT_CONFIG_KEY_${index}=${key}`, `GIT_CONFIG_VALUE_${index}=${value}`])]
  }

  /** Current authority for logged system-prompt assembly.
   * @returns environment identity, revision, active operations and expiry without credentials or host paths.
   */
  guidance(): string {
    return JSON.stringify({ environment: this.config.name, environmentId: this.config.id, revision: this.record.revision,
      requestableRepositories: this.config.repositories.map(repository => ({ repository: repository.url, access: repository.pushCredentialCommand === undefined ? ['fetch'] : ['fetch', 'push'] })),
      anyHttpsRemote: this.config.remoteRepositories !== undefined,
      repositories: this.record.grants.filter(grant => grant.expiresAt > Date.now())
        .map(({ repository, access, expiresAt }) => ({ repository, access, expiresAt })) })
  }

  private async publish(record: EnvironmentAccessRecord): Promise<void> {
    await publishWorkspaceJson(this.path, record, this.maxBytes)
    this.record = record
    this.credentials.clear()
  }

  private async change<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.mutation.then(operation)
    this.mutation = current.then(() => {}, () => {})
    return await current
  }
}

function validateConfig(config: EnvironmentAccessConfig): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u.test(config.id) || config.name.trim().length === 0
    || !Number.isSafeInteger(config.grantLifetimeMs) || config.grantLifetimeMs < 1 || config.grantLifetimeMs > 2_147_483_647) throw new Error('invalid environment identity, name, or grant lifetime')
  if (new Set(config.repositories.map(repository => repository.url)).size !== config.repositories.length
    || new Set(config.repositories.map(repository => repository.source)).size !== config.repositories.length) throw new Error('environment repository URLs and sources must be unique')
  for (const repository of config.repositories) {
    for (const command of [repository.fetchCredentialCommand, repository.pushCredentialCommand]) {
      validateGitRemote({ source: repository.source, url: repository.url, credentialTimeoutMs: repository.credentialTimeoutMs,
        ...command === undefined ? {} : { credentialCommand: command } })
    }
    if (repository.fetchCredentialCommand !== undefined && repository.fetchCredentialCommand === repository.pushCredentialCommand) throw new Error('fetch and push credentials require distinct scoped issuers')
  }
  if (new Set(config.initialGrants.map(grant => grant.repository)).size !== config.initialGrants.length
    || config.initialGrants.some(grant => !config.repositories.some(repository => repository.url === grant.repository))) throw new Error('initial environment grants must name distinct catalog repositories')
  const remote = config.remoteRepositories
  if (remote !== undefined) {
    validateGitRemote({ source: '/validation', url: 'https://example.com/org/repository', credentialTimeoutMs: remote.credentialTimeoutMs })
    if (new Set(remote.providers.map(provider => provider.origin)).size !== remote.providers.length) throw new Error('remote credential origins must be unique')
    for (const provider of remote.providers) {
      const url = new URL(provider.origin)
      if (url.origin !== provider.origin || url.protocol !== 'https:') throw new Error('remote credential provider requires an exact HTTPS origin')
      for (const command of [provider.fetchCredentialCommand, provider.pushCredentialCommand]) {
        validateGitRemote({ source: '/validation', url: `${provider.origin}/org/repository`, credentialTimeoutMs: remote.credentialTimeoutMs,
          ...command === undefined ? {} : { credentialCommand: command } })
      }
      if (provider.fetchCredentialCommand !== undefined && provider.fetchCredentialCommand === provider.pushCredentialCommand) throw new Error('fetch and push credentials require distinct scoped issuers')
    }
  }
}

function knownRepository(repository: string, config: EnvironmentAccessConfig): boolean {
  if (config.repositories.some(entry => entry.url === repository)) return true
  if (config.remoteRepositories === undefined) return false
  try { validateGitRemote({ source: '/validation', url: repository, credentialTimeoutMs: config.remoteRepositories.credentialTimeoutMs }); return true }
  catch { return false }
}

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function parseRecord(value: unknown, config: EnvironmentAccessConfig): EnvironmentAccessRecord {
  if (!object(value) || value.version !== 1 || value.environmentId !== config.id || !Number.isSafeInteger(value.revision)
    || Number(value.revision) < 0 || !Array.isArray(value.grants) || !Array.isArray(value.history)
    || value.history.length !== value.revision) throw new Error('invalid environment access record')
  const seen = new Set<string>()
  for (const grant of value.grants as unknown[]) {
    validateGrant(grant, config, value.revision)
    if (seen.has(grant.repository)) throw new Error('duplicate environment repository grant')
    seen.add(grant.repository)
  }
  const restored = new Map<string, unknown>()
  for (const [index, change] of (value.history as unknown[]).entries()) {
    if (!object(change)) throw new Error('invalid environment access history')
    if (change.kind === 'grant') {
      validateGrant(change.grant, config, value.revision)
      if (change.grant.revision !== index + 1) throw new Error('invalid environment access history revision')
      restored.delete(change.grant.repository)
      restored.set(change.grant.repository, change.grant)
    } else if (change.kind === 'revoke' && change.revision === index + 1 && typeof change.repository === 'string'
      && knownRepository(change.repository, config)
      && Number.isSafeInteger(change.revokedAt) && Number(change.revokedAt) >= 0
      && Number(change.credentialsExpireBy) === Number(change.revokedAt) + 3_600_000) {
      restored.delete(change.repository)
    } else throw new Error('invalid environment access history')
  }
  if (JSON.stringify([...restored.values()]) !== JSON.stringify(value.grants)) throw new Error('environment grants do not match their decision history')
  return value as unknown as EnvironmentAccessRecord
}

function validateGrant(grant: unknown, config: EnvironmentAccessConfig, revision: number): asserts grant is RepositoryGrant {
  if (!object(grant) || typeof grant.repository !== 'string'
      || !knownRepository(grant.repository, config) || !['fetch', 'push'].includes(String(grant.access))
      || !Number.isSafeInteger(grant.revision) || Number(grant.revision) < 1 || Number(grant.revision) > revision
      || !Number.isSafeInteger(grant.approvedAt) || !Number.isSafeInteger(grant.expiresAt)
      || Number(grant.expiresAt) <= Number(grant.approvedAt)
      || !object(grant.approval) || !['deployment', 'user'].includes(String(grant.approval.kind))) throw new Error('invalid environment repository grant')
  if (grant.approval.kind === 'user' && [grant.approval.sessionId, grant.approval.questionId, grant.approval.reason].some(field => typeof field !== 'string' || field.length === 0)) throw new Error('invalid environment grant approval')
}
