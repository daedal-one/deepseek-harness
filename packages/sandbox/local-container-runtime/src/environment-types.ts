/** Environment-owned repository capabilities, independent of agent lifetimes. @module */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable deployment environment identity. */
export type EnvironmentId = Branded<'EnvironmentId'>
/** Repository operations granted by a user; push includes fetch. */
export type RepositoryAccess = 'fetch' | 'push'

/** Operator-controlled catalog entry; sandbox input cannot choose a host executable or source. */
export interface EnvironmentRepository {
  /** Canonical credential-free HTTPS remote. */
  url: string
  /** Canonical host checkout available for isolated import and result return. */
  source: string
  /** Helper that issues credentials limited to repository reads. */
  fetchCredentialCommand?: string
  /** Helper that issues credentials permitting repository writes. */
  pushCredentialCommand?: string
  /** Maximum duration of one helper invocation. */
  credentialTimeoutMs: number
}

/** Stable environment configuration and requestable repository capabilities. */
export interface EnvironmentAccessConfig {
  id: string
  name: string
  /** Lifetime of a user-approved grant, independent of session completion. */
  grantLifetimeMs: number
  repositories: EnvironmentRepository[]
  /** Permit approved HTTPS remotes without a pre-existing host checkout. */
  remoteRepositories?: {
    /** Maximum duration of a repository-scoped credential request. */
    credentialTimeoutMs: number
    /** Exact provider origins; absent origins use anonymous Git access. */
    providers: Array<{
      origin: string
      fetchCredentialCommand?: string
      pushCredentialCommand?: string
    }>
  }
  /** Explicit operator-approved capabilities applied only when the environment is first created. */
  initialGrants: Array<{ repository: string; access: RepositoryAccess }>
}

/** Durable user decision or initial deployment authorization. */
export type RepositoryApproval = { kind: 'deployment' } | {
  kind: 'user'
  sessionId: string
  questionId: string
  reason: string
}

/** Persisted capability; credentials never form part of this record. */
export interface RepositoryGrant {
  repository: string
  access: RepositoryAccess
  revision: number
  approvedAt: number
  expiresAt: number
  approval: RepositoryApproval
}

/** Current durable environment authority. */
export interface EnvironmentAccessRecord {
  version: 1
  environmentId: EnvironmentId
  revision: number
  grants: RepositoryGrant[]
  /** Ordered decisions retained after escalation, expiry, and revocation. */
  history: Array<{ kind: 'grant'; grant: RepositoryGrant } | {
    kind: 'revoke'
    repository: string
    revision: number
    revokedAt: number
    credentialsExpireBy: number
  }>
}
