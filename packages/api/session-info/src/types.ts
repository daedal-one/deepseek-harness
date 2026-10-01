/**
 * Browser-safe vocabulary for the Session Info Remote: one point-in-time
 * snapshot of a Session's identity, Workspace, execution environment, and
 * effective command-authorization policy.
 *
 * @module @deepseek-ai/dsh-session-info/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Execution placement verified from the Session's effective file and process providers. */
export type SessionInfoPlacement = 'host' | 'container' | 'external' | 'unknown'

/** File-sandbox mode the Session's confined calls run under. */
export type SessionInfoSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/** Approval policy the Session's asks resolve under. */
export type SessionInfoApprovalPolicy = 'ask' | 'never'

/** Durable model route the Session's latest selection names. */
export interface SessionInfoModel {
  /** Provider id of the durable selection. */
  readonly provider: string
  /** Exact model id of the durable selection. */
  readonly model: string
}

/** Identity and whole-log figures of the Session. */
export interface SessionInfoSessionFacts {
  /** The Session this reading describes. */
  readonly sessionId: SessionId
  /** Latest durable title, or null before one lands. */
  readonly title: string | null
  /** Preset the Session runs, or null when the deployment composes none. */
  readonly agentPreset: string | null
  /** Latest durable model selection, or null when none is recorded. */
  readonly model: SessionInfoModel | null
  /** Immutable Session working directory, or null when the header carries none. */
  readonly cwd: string | null
  /** Distinct turns carrying at least one closed step. */
  readonly turns: number
  /** Closed steps across the whole log. */
  readonly steps: number
}

/** Workspace registration accounting this Session, when one exists. */
export interface SessionInfoWorkspaceFacts {
  /** Stable Workspace record id. */
  readonly workspaceId: string
  /** Canonical Workspace directory path. */
  readonly path: string
  /** User-visible Workspace title. */
  readonly title: string
}

/** Host process and execution-environment facts. */
export interface SessionInfoEnvironmentFacts {
  /** Verified execution placement of the Session's providers. */
  readonly placement: SessionInfoPlacement
  /** Host operating-system platform id (`process.platform`). */
  readonly platform: string
  /** Host processor architecture (`process.arch`). */
  readonly arch: string
  /** Host operating-system release string. */
  readonly release: string
  /** Host Node.js version string. */
  readonly node: string
  /** Host home directory. */
  readonly home: string
}

/** Command-authorization policy in force for the Session. */
export interface SessionInfoPolicyFacts {
  /** Effective file-sandbox mode, or null when no policy service is composed. */
  readonly sandboxMode: SessionInfoSandboxMode | null
  /** Deployment default file-sandbox mode, or null when no policy service is composed. */
  readonly sandboxDefault: SessionInfoSandboxMode | null
  /** Absolute `workspace-write` boundary for the Session, or null without a policy service. */
  readonly workspaceRoot: string | null
  /** Effective approval policy, or null when no approval service is composed. */
  readonly approvalPolicy: SessionInfoApprovalPolicy | null
  /** Deployment default approval policy, or null when no approval service is composed. */
  readonly approvalDefault: SessionInfoApprovalPolicy | null
  /** Effective permission-preset key, or null when the permission service is absent. */
  readonly permissionPreset: string | null
  /** Declared description of the effective permission preset, when the deployment supplies one. */
  readonly permissionPresetDescription: string | null
  /** Whether the preset may still change, or null when the permission service is absent. */
  readonly canChangePermission: boolean | null
}

/** Point-in-time answer to one `sessionInfo/read` call. */
export interface SessionInfoSnapshot {
  /** Session identity and whole-log figures. */
  readonly session: SessionInfoSessionFacts
  /** Workspace registration accounting the Session, or null when unregistered. */
  readonly workspace: SessionInfoWorkspaceFacts | null
  /** Host process and execution-environment facts. */
  readonly environment: SessionInfoEnvironmentFacts
  /** Effective command-authorization policy. */
  readonly policies: SessionInfoPolicyFacts
  /** Epoch milliseconds at which this reading was assembled. */
  readonly readAt: number
}

/** Why one Session Info read could not complete. */
export interface SessionInfoFailure {
  /** The Session is not live on this Host. */
  readonly reason: 'session-unavailable'
  /** Human-readable explanation that names no secret. */
  readonly detail: string
}

/** Result of one `sessionInfo/read` Remote call. */
export type SessionInfoReadResult =
  | { readonly ok: true; readonly value: SessionInfoSnapshot }
  | { readonly ok: false; readonly error: SessionInfoFailure }

/** Request for one `sessionInfo/read` Remote call. */
export interface SessionInfoReadRequest {
  /** Session whose facts, environment, and policy are read. */
  readonly sessionId: SessionId
}
