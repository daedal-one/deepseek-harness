/** Forge adapter wire vocabulary and strict request validation. */

import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'

/** Forge-to-harness lifecycle protocol implemented by this adapter. */
export const FORGE_SESSION_PROTOCOL = 'forge.agent.session/v1'
/** Forge Intellect evidence protocol required for accountable actions. */
export const FORGE_EVIDENCE_PROTOCOL = 'forge.intellect.action/v2'
/** Forge Intellect MCP tool surface exposed inside adapter-created agents. */
export const FORGE_ACTION_TOOLS_PROTOCOL = 'forge-intellect-action-tools/v1'
/** Forge Spec baselines accepted without rewriting the caller's intent. */
export const FORGE_SPEC_BASELINES = ['forge-spec-v0.6.0', 'forge-spec-v0.7.0'] as const
/** Forge preflight envelope required by the start command. */
export const FORGE_PREFLIGHT_PROTOCOL = 'forge.spec.preflight/v1'

/** Complete command vocabulary advertised by the Forge session adapter. */
export const FORGE_COMMANDS = [
  'start', 'send', 'queue', 'steer', 'approve', 'cancel',
  'inspect', 'checkpoint', 'diff', 'close',
] as const

/** One lifecycle command accepted from Forge. */
export type ForgeCommand = typeof FORGE_COMMANDS[number]
/** Terminal outcome vocabulary shared with the Forge worker. */
export type ForgeOutcome =
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'policy_denied'
  | 'unsupported'
  | 'evidence_incomplete'
  | 'cleanup_failed'

/** Immutable executor authority supplied by Forge for one session. */
export interface ExecutorPolicy {
  readonly max_minutes: number
  readonly network: 'none' | 'restricted' | 'project'
  readonly tools: string[]
  readonly credential_scopes: string[]
  readonly workspace: string
  readonly executor_lease_id: string
}

/** Exact Forge Spec render and Forge Intellect evidence accepted at startup. */
export interface ForgePreflight {
  readonly protocol: typeof FORGE_PREFLIGHT_PROTOCOL
  readonly baseline: typeof FORGE_SPEC_BASELINES[number]
  readonly workspace_revision: string
  readonly target: string
  readonly rendered: string
  readonly rendered_sha256: string
  readonly lint_errors: 0
  readonly evidence: {
    readonly protocol: typeof FORGE_EVIDENCE_PROTOCOL
    readonly action_id: string
    readonly digest: string
  }
}

/** Validated payload for the first command of a Forge-owned session. */
export interface StartPayload extends Record<string, unknown> {
  readonly intent: ForgePreflight
  readonly prompt?: string
  readonly llm?: {
    readonly provider?: string
    readonly model?: string
    readonly max_tokens?: number
  }
}

/** Authenticated command envelope sent by Forge. */
export interface ForgeCommandRequest {
  readonly protocol: typeof FORGE_SESSION_PROTOCOL
  readonly session_id: string
  readonly project_id: string
  readonly work_id: string
  readonly intent_revision: string
  readonly causality_id: string
  readonly command: ForgeCommand
  readonly idempotency_key: string
  readonly payload: Record<string, unknown>
  readonly executor_policy: ExecutorPolicy
}

/** Ordered adapter event returned to Forge for durable ingestion. */
export interface ForgeAdapterEvent {
  readonly protocol: typeof FORGE_SESSION_PROTOCOL
  readonly sequence: number
  readonly type: string
  readonly event_type: string
  readonly session_id: string
  readonly causality_id: string
  readonly time: string
  readonly data: Record<string, unknown>
}

/** Normalized command response containing status, events, and evidence. */
export interface ForgeCommandResponse {
  readonly status: string
  readonly events: ForgeAdapterEvent[]
  readonly outcome?: ForgeOutcome
  readonly evidence?: unknown
}

/** Request-boundary error with a stable HTTP status and Forge outcome. */
export class ProtocolError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly outcome: ForgeOutcome = 'unsupported',
  ) {
    super(message)
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ProtocolError(`${label} must be a non-empty string`)
  }
  return value
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new ProtocolError(`${label} must be an array of strings`)
  }
  const result: string[] = []
  for (const item of value as unknown[]) {
    if (typeof item !== 'string') throw new ProtocolError(`${label} must be an array of strings`)
    result.push(item)
  }
  return result
}

/**
 * Parse one untrusted Forge command without accepting provider-native required fields.
 * @param value - Untrusted decoded JSON received from Forge.
 * @returns A normalized command request safe for adapter dispatch.
 */
export function parseCommandRequest(value: unknown): ForgeCommandRequest {
  const input = object(value, 'request')
  if (input.protocol !== FORGE_SESSION_PROTOCOL) {
    throw new ProtocolError(`protocol must be ${FORGE_SESSION_PROTOCOL}`, 409)
  }
  const command = string(input.command, 'command')
  if (!(FORGE_COMMANDS as readonly string[]).includes(command)) {
    throw new ProtocolError(`unsupported command ${JSON.stringify(command)}`, 422)
  }
  const policy = object(input.executor_policy, 'executor_policy')
  const workspace = string(policy.workspace, 'executor_policy.workspace')
  if (!isAbsolute(workspace)) {
    throw new ProtocolError('executor_policy.workspace must be absolute')
  }
  const maxMinutes = policy.max_minutes
  if (!Number.isSafeInteger(maxMinutes) || Number(maxMinutes) < 1 || Number(maxMinutes) > 480) {
    throw new ProtocolError('executor_policy.max_minutes must be an integer in 1..480')
  }
  if (!['none', 'restricted', 'project'].includes(String(policy.network))) {
    throw new ProtocolError('executor_policy.network is invalid')
  }
  const tools = stringArray(policy.tools, 'executor_policy.tools')
  const credentialScopes = stringArray(policy.credential_scopes, 'executor_policy.credential_scopes')
  const executorLeaseId = string(policy.executor_lease_id, 'executor_policy.executor_lease_id')
  if (!/^agent-[a-f0-9]{24}$/.test(executorLeaseId)) {
    throw new ProtocolError('executor_policy.executor_lease_id is invalid')
  }
  if (tools.some(item => item === '*' || item === 'docker.sock' || item === 'root')) {
    throw new ProtocolError('executor policy requests forbidden tool authority', 403, 'policy_denied')
  }
  if (credentialScopes.some(item => item === '*' || item === 'root')) {
    throw new ProtocolError('executor policy requests forbidden credential authority', 403, 'policy_denied')
  }
  return {
    protocol: FORGE_SESSION_PROTOCOL,
    session_id: string(input.session_id, 'session_id'),
    project_id: string(input.project_id, 'project_id'),
    work_id: string(input.work_id, 'work_id'),
    intent_revision: string(input.intent_revision, 'intent_revision'),
    causality_id: string(input.causality_id, 'causality_id'),
    command: command as ForgeCommand,
    idempotency_key: string(input.idempotency_key, 'idempotency_key'),
    payload: object(input.payload ?? {}, 'payload'),
    executor_policy: {
      max_minutes: Number(maxMinutes),
      network: policy.network as ExecutorPolicy['network'],
      tools,
      credential_scopes: credentialScopes,
      workspace,
      executor_lease_id: executorLeaseId,
    },
  }
}

/**
 * Validate the exact Forge Spec render and its Forge Intellect preflight evidence.
 * @param request - Parsed start command whose payload carries the preflight.
 * @returns The normalized start payload bound to the command identity.
 */
export function parseStartPayload(request: ForgeCommandRequest): StartPayload {
  const payload = request.payload
  const intent = object(payload.intent, 'payload.intent')
  if (intent.protocol !== FORGE_PREFLIGHT_PROTOCOL) {
    throw new ProtocolError(`payload.intent.protocol must be ${FORGE_PREFLIGHT_PROTOCOL}`, 409)
  }
  const baseline = intent.baseline
  if (baseline !== FORGE_SPEC_BASELINES[0] && baseline !== FORGE_SPEC_BASELINES[1]) {
    throw new ProtocolError(`payload.intent.baseline must be one of ${FORGE_SPEC_BASELINES.join(', ')}`, 409)
  }
  const revision = string(intent.workspace_revision, 'payload.intent.workspace_revision')
  if (revision !== request.intent_revision) {
    throw new ProtocolError('preflight workspace revision does not match intent_revision', 409)
  }
  const target = string(intent.target, 'payload.intent.target')
  if (target !== request.work_id) {
    throw new ProtocolError('preflight target does not match work_id', 409)
  }
  if (intent.lint_errors !== 0) {
    throw new ProtocolError('Forge Spec preflight did not pass lint', 409, 'policy_denied')
  }
  const rendered = string(intent.rendered, 'payload.intent.rendered')
  const renderedSha256 = string(intent.rendered_sha256, 'payload.intent.rendered_sha256')
  const actualSha256 = createHash('sha256').update(rendered).digest('hex')
  if (renderedSha256 !== actualSha256) {
    throw new ProtocolError('Forge Spec render digest does not match rendered bytes', 409)
  }
  const evidence = object(intent.evidence, 'payload.intent.evidence')
  if (evidence.protocol !== FORGE_EVIDENCE_PROTOCOL) {
    throw new ProtocolError(`payload.intent.evidence.protocol must be ${FORGE_EVIDENCE_PROTOCOL}`, 409)
  }
  const llm = payload.llm === undefined ? undefined : object(payload.llm, 'payload.llm')
  const maxTokens = llm?.max_tokens
  if (maxTokens !== undefined && (!Number.isSafeInteger(maxTokens) || Number(maxTokens) < 1)) {
    throw new ProtocolError('payload.llm.max_tokens must be a positive safe integer')
  }
  return {
    intent: {
      protocol: FORGE_PREFLIGHT_PROTOCOL,
      baseline,
      workspace_revision: revision,
      target,
      rendered,
      rendered_sha256: renderedSha256,
      lint_errors: 0,
      evidence: {
        protocol: FORGE_EVIDENCE_PROTOCOL,
        action_id: string(evidence.action_id, 'payload.intent.evidence.action_id'),
        digest: string(evidence.digest, 'payload.intent.evidence.digest'),
      },
    },
    ...payload.prompt === undefined ? {} : { prompt: string(payload.prompt, 'payload.prompt') },
    ...llm === undefined ? {} : {
      llm: {
        ...llm.provider === undefined ? {} : { provider: string(llm.provider, 'payload.llm.provider') },
        ...llm.model === undefined ? {} : { model: string(llm.model, 'payload.llm.model') },
        ...maxTokens === undefined ? {} : { max_tokens: Number(maxTokens) },
      },
    },
  }
}

/**
 * Stable UUID-shaped identity for one Intellect workspace or action session.
 * @param value - Canonical identity material shared by Forge and the adapter.
 * @returns A deterministic UUIDv5-compatible identifier.
 */
export function stableUuid(value: string): string {
  const namespace = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex')
  const bytes = createHash('sha1').update(namespace).update(value).digest().subarray(0, 16)
  bytes[6] = (bytes.readUInt8(6) & 0x0f) | 0x50
  bytes[8] = (bytes.readUInt8(8) & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
