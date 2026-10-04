/** Operator-owned admission of exact logical Session histories to execution compositions. */

import { createHash, type Hash } from 'node:crypto'
import { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset, type Session } from '@deepseek-ai/dsh-session'
import type { SessionAdmission, SessionAdmissionPrefix, SessionAdmissionSha256, SessionCompositionSource } from './admission-types.ts'
export type { SessionAdmission, SessionAdmissionPrefix, SessionAdmissionSha256, SessionCompositionSource } from './admission-types.ts'
import { z } from 'zod'
import { PRESET_ID } from './preset.ts'
import { agentPresetProjectionDefinition } from './session.ts'

const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  .refine(value => !Object.is(value, -0))
const admissionSchema = z.strictObject({
  sessionId: z.string().min(1).transform(SessionId),
  agentPreset: z.string().regex(PRESET_ID),
  createdAt: safeInteger,
  cwd: z.string().min(1),
  parentSession: z.string().min(1).transform(SessionId).nullable(),
  origin: z.literal('subagent').nullable(),
  delegationDepth: safeInteger.nullable(),
  isSeeded: z.boolean(),
  inheritedEventCount: safeInteger.transform(SessionLogOffset),
  prefix: z.strictObject({
    encoding: z.literal('logical-json-v1'),
    formatVersion: z.literal(SESSION_FORMAT_VERSION),
    eventCount: safeInteger.refine(value => value > 0),
    sha256: z.string().regex(/^[0-9a-f]{64}$/).transform(value => value as SessionAdmissionSha256),
  }).readonly(),
  compositionPreset: z.string().regex(PRESET_ID),
}).refine(value => value.inheritedEventCount <= value.prefix.eventCount
  && (value.isSeeded || value.inheritedEventCount === 0), {
  message: 'inheritedEventCount must fit the admitted prefix and be zero for an unseeded Session',
}).readonly()

/**
 * Validate and detach operator configuration; the private map owns frozen entries.
 * @param input - configuration value after omission has resolved to an empty list.
 * @returns a read-only admission lookup, independent of the input's mutable objects.
 * @throws when an entry is malformed or a Session ID occurs more than once.
 */
export function resolveSessionAdmissions(input: unknown): ReadonlyMap<SessionId, SessionAdmission> {
  const entries = z.array(admissionSchema).parse(input)
  const map = new Map<SessionId, SessionAdmission>()
  for (const entry of entries) {
    if (map.has(entry.sessionId)) throw new Error(`agent-presets: duplicate session admission "${entry.sessionId}"`)
    map.set(entry.sessionId, entry)
  }
  return map
}

/**
 * Read the immutable logical data used by admission and cold composition readers.
 * @param session - restored or freshly prepared Session.
 * @returns its header, inherited count, and current event snapshot.
 */
export function sessionCompositionSource(session: Session): SessionCompositionSource {
  return { header: session.header, inheritedEventCount: session.inheritedEventCount, events: session.snapshotEvents() }
}

/**
 * Fold the owning preset projection over logical storage data without an Agent.
 * @param source - current logical Session data.
 * @returns the selected logical preset, or undefined when none was recorded.
 */
export function logicalPresetForSource(source: SessionCompositionSource): string | undefined {
  let value = agentPresetProjectionDefinition.init(source.header)
  for (const event of source.events) value = agentPresetProjectionDefinition.apply(value, event)
  return value ?? undefined
}

/**
 * Classify a cold history that must not use an ordinary fallback without its own admission.
 * Recorded host placement only matters for logical presets remapped by this manifest;
 * it cannot authorize a composition or classify an unrelated unique-host preset.
 * @param source - retained logical Session observation.
 * @param admissions - immutable operator admission lookup.
 * @returns whether ordinary fallback must be refused.
 */
export function requiresSessionAdmission(
  source: SessionCompositionSource,
  admissions: ReadonlyMap<SessionId, SessionAdmission>,
): boolean {
  if (admissions.has(source.header.id)
    || source.header.parentSession !== undefined && admissions.has(source.header.parentSession)) return true
  const logical = logicalPresetForSource(source)
  if (logical === undefined || ![...admissions.values()].some(entry =>
    entry.agentPreset === logical && entry.compositionPreset !== logical)) return false
  const latest = source.events.findLast(event => (event as { type: string }).type === 'permission/context')
  const data: unknown = latest === undefined ? undefined : (latest as { data: unknown }).data
  return typeof data === 'object' && data !== null && 'environment' in data && data.environment === 'host'
}

function hashJson(hash: Hash, value: unknown): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || typeof value === 'number' && Number.isFinite(value)) {
    hash.update(JSON.stringify(value), 'utf8')
  } else if (Array.isArray(value)) {
    hash.update('[')
    for (let index = 0; index < value.length; index++) {
      if (index > 0) hash.update(',')
      hashJson(hash, value[index])
    }
    hash.update(']')
  } else if (typeof value === 'object') {
    hash.update('{')
    const keys = Object.keys(value).sort()
    for (const [index, key] of keys.entries()) {
      if (index > 0) hash.update(',')
      hash.update(JSON.stringify(key), 'utf8')
      hash.update(':')
      hashJson(hash, (value as Record<string, unknown>)[key])
    }
    hash.update('}')
  } else {
    throw new Error('agent-presets: logical prefix contains a non-JSON value')
  }
}

/**
 * Stream canonical JSON directly into SHA-256, retaining full event envelopes.
 * Object keys use UTF-16 code-unit order; array order and JSON primitive encoding are preserved.
 * @param source - validated current logical Session data, not physical JSONL bytes.
 * @param eventCount - positive safe-integer length of the immutable original prefix.
 * @returns the domain-separated fingerprint of [formatVersion, eventCount, prefix events].
 * @throws when the format is not current or the requested prefix is invalid or truncated.
 */
export function fingerprintSessionPrefix(source: SessionCompositionSource, eventCount: number): SessionAdmissionPrefix {
  if ((source.header.version as number) !== SESSION_FORMAT_VERSION) {
    throw new Error('agent-presets: admission requires the current logical Session format')
  }
  if (!Number.isSafeInteger(eventCount) || eventCount <= 0 || eventCount > source.events.length) {
    throw new Error('agent-presets: admission prefix eventCount is invalid or the history is truncated')
  }
  const hash = createHash('sha256')
  hash.update('dsh-agent-presets/logical-json-v1\0', 'utf8')
  hash.update(`[${SESSION_FORMAT_VERSION},${eventCount},[`)
  for (let index = 0; index < eventCount; index++) {
    if (index > 0) hash.update(',')
    hashJson(hash, source.events[index])
  }
  hash.update(']]')
  return Object.freeze({
    encoding: 'logical-json-v1',
    formatVersion: SESSION_FORMAT_VERSION,
    eventCount,
    sha256: hash.digest('hex') as SessionAdmissionSha256,
  })
}

/**
 * Validate restored identity and the original prefix before resolving any standing composition.
 * Explicit null in configuration means the header field must be absent, including delegation depth.
 * @param source - restored logical data, including any later resume or permission suffix.
 * @param admission - validated operator entry for this exact Session.
 * @throws when identity, current logical preset, or the prefix differs from the admission.
 */
export function validateSessionAdmission(source: SessionCompositionSource, admission: SessionAdmission): void {
  const { header } = source
  const identity = {
    sessionId: header.id,
    agentPreset: header.agentPreset,
    createdAt: header.createdAt,
    cwd: header.cwd,
    parentSession: header.parentSession === undefined ? null : header.parentSession,
    origin: header.origin === undefined ? null : header.origin,
    delegationDepth: header.delegationDepth === undefined ? null : header.delegationDepth,
    isSeeded: header.isSeeded,
    inheritedEventCount: source.inheritedEventCount,
  }
  for (const field of Object.keys(identity) as (keyof typeof identity)[]) {
    if (identity[field] !== admission[field]) {
      throw new Error(`agent-presets: session admission "${admission.sessionId}" mismatches ${field}`)
    }
  }
  if (logicalPresetForSource(source) !== admission.agentPreset) {
    throw new Error(`agent-presets: session admission "${admission.sessionId}" mismatches the selected logical preset`)
  }
  const prefix = fingerprintSessionPrefix(source, admission.prefix.eventCount)
  if (prefix.sha256 !== admission.prefix.sha256) {
    throw new Error(`agent-presets: session admission "${admission.sessionId}" prefix digest mismatch`)
  }
}
