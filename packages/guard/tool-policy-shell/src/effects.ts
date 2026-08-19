/** Closed shell-effect evidence and deterministic authorization policy. @module @deepseek-ai/dsh-tool-policy-shell/effects */

import { ToolPolicyProviderId, type ToolPolicyOpinion, type ToolPolicyVerdict } from '@deepseek-ai/dsh-tool-policy'

/** Effects an auxiliary reviewer may attribute to one exact shell command or intent. */
export const SHELL_EFFECTS = [
  'local-compute',
  'workspace-read',
  'host-read',
  'process-read',
  'workspace-write',
  'workspace-delete',
  'temporary-write',
  'outside-workspace-read',
  'outside-workspace-write',
  'network-read',
  'external-mutation',
  'credential-access',
  'process-control',
  'privileged',
  'destructive',
  'unknown',
] as const

/** One validated member of {@link SHELL_EFFECTS}. */
export type ShellEffect = typeof SHELL_EFFECTS[number]

/** Relationship between the user's request and the acting model's stated intent. */
export type IntentAlignment = 'aligned' | 'unclear' | 'conflicting'

/** Bounded independent context derived only from direct user messages. */
export interface IntentReview {
  readonly summary: string
  readonly allowedEffects: readonly ShellEffect[]
  readonly forbiddenEffects: readonly ShellEffect[]
}

/** Bounded command-effect and acting-intent evidence produced from sanitized user context. */
export interface EffectReview {
  readonly effects: readonly ShellEffect[]
  readonly alignment: IntentAlignment
}

/** Bounds applied after parsing untrusted auxiliary output. */
export interface EvidenceBounds {
  readonly maxEffects: number
  readonly maxSummaryChars: number
}

const effectSet = new Set<string>(SHELL_EFFECTS)
const baselineAllowed = new Set<ShellEffect>([
  'local-compute',
  'workspace-read',
  'host-read',
  'process-read',
  'temporary-write',
])
const intentRequired = new Set<ShellEffect>(['workspace-write', 'workspace-delete', 'outside-workspace-read'])

function boundedText(value: string, limit: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, limit)
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(record).sort().join(',') === [...expected].sort().join(',')
}

function effectsOf(value: unknown, bounds: EvidenceBounds): ShellEffect[] | undefined {
  if (!Array.isArray(value) || value.length > bounds.maxEffects) return undefined
  if (!value.every(item => typeof item === 'string' && effectSet.has(item))) return undefined
  return [...new Set(value as ShellEffect[])]
}

/**
 * Validate and bound an intent review returned by an auxiliary model.
 * @param value - parsed JSON output from the intent route.
 * @param bounds - deployment-owned output bounds.
 * @returns validated evidence, or `undefined` for an invalid response.
 */
export function parseIntentReview(value: unknown, bounds: EvidenceBounds): IntentReview | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (!exactKeys(record, ['summary', 'allowedEffects', 'forbiddenEffects'])) return undefined
  if (typeof record['summary'] !== 'string') return undefined
  const allowedEffects = effectsOf(record['allowedEffects'], bounds)
  const forbiddenEffects = effectsOf(record['forbiddenEffects'], bounds)
  if (allowedEffects === undefined || forbiddenEffects === undefined) return undefined
  if (allowedEffects.some(effect => forbiddenEffects.includes(effect))) return undefined
  return {
    summary: boundedText(record['summary'], bounds.maxSummaryChars),
    allowedEffects,
    forbiddenEffects,
  }
}

/**
 * Validate and bound command-effect evidence returned by an auxiliary model.
 * @param value - parsed JSON output from one effect route.
 * @param bounds - deployment-owned output bounds.
 * @returns validated evidence, or `undefined` for an invalid response.
 */
export function parseEffectReview(value: unknown, bounds: EvidenceBounds): EffectReview | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (!exactKeys(record, ['effects', 'alignment'])) return undefined
  const effects = effectsOf(record['effects'], bounds)
  if (effects === undefined || effects.length === 0) return undefined
  if (!['aligned', 'unclear', 'conflicting'].includes(String(record['alignment']))) return undefined
  return { effects, alignment: record['alignment'] as IntentAlignment }
}

/**
 * Convert validated intent evidence into one auditable provider opinion.
 * @param providerId - route-specific opinion identity.
 * @param review - validated intent evidence.
 * @returns a bounded opinion for durable policy audit.
 */
export function intentOpinion(providerId: ToolPolicyProviderId, review: IntentReview): ToolPolicyOpinion {
  return {
    providerId,
    decision: 'allow',
    risk: 0,
    categories: [
      ...review.allowedEffects.map(effect => `allows:${effect}`),
      ...review.forbiddenEffects.map(effect => `forbids:${effect}`),
    ],
    reason: 'independent user intent context is available',
  }
}

function effectRisk(review: EffectReview): number {
  if (review.alignment === 'conflicting' || review.effects.includes('destructive')) return 100
  if (review.alignment === 'unclear') return 40
  if (review.effects.some(effect => [
    'credential-access', 'process-control', 'privileged', 'external-mutation', 'outside-workspace-write',
  ].includes(effect))) return 80
  if (review.effects.some(effect => ['workspace-delete', 'network-read'].includes(effect))) return 60
  if (review.effects.some(effect => ['workspace-write', 'outside-workspace-read'].includes(effect))) return 30
  return 5
}

/**
 * Convert validated effect evidence into one auditable provider opinion.
 * @param providerId - route-specific opinion identity.
 * @param review - validated command-effect evidence.
 * @returns a bounded opinion for durable policy audit.
 */
export function effectOpinion(providerId: ToolPolicyProviderId, review: EffectReview): ToolPolicyOpinion {
  const decision = review.alignment === 'conflicting' || !review.effects.every(effect => baselineAllowed.has(effect)) ? 'ask' : 'allow'
  return {
    providerId, decision, risk: effectRisk(review), categories: [`intent:${review.alignment}`, ...review.effects],
    reason: `effect classifier found ${review.alignment} acting intent`,
  }
}

function verdict(
  providerId: ToolPolicyProviderId,
  decision: 'allow' | 'ask',
  risk: number,
  categories: readonly string[],
  reason: string,
  opinions: readonly ToolPolicyOpinion[],
): ToolPolicyVerdict {
  return { providerId, decision, risk, categories, reason, opinions }
}

/**
 * Derive authorization from validated independent intent and command effects.
 * Deterministic hard denials and deployment rules run before this policy.
 * @param providerId - effective shell policy provider id.
 * @param intent - bounded user/agent intent evidence.
 * @param effect - bounded command-effect evidence.
 * @param opinions - every model opinion retained for audit.
 * @returns an allow or ask verdict; model evidence never creates a hard denial.
 */
export function decideEvidence(
  providerId: ToolPolicyProviderId,
  intent: IntentReview,
  effect: EffectReview,
  opinions: readonly ToolPolicyOpinion[],
): ToolPolicyVerdict {
  const risk = effectRisk(effect)
  const categories = [...new Set(opinions.flatMap(opinion => opinion.categories))]
  if (effect.alignment === 'conflicting') {
    return verdict(providerId, 'ask', risk, categories, "agent-stated intent conflicts with the user's request", opinions)
  }
  const forbidden = effect.effects.filter(item => intent.forbiddenEffects.includes(item))
  if (forbidden.length > 0) {
    return verdict(providerId, 'ask', risk, categories, `command effects conflict with user restrictions: ${forbidden.join(', ')}`, opinions)
  }
  const sensitive = effect.effects.filter(item => !baselineAllowed.has(item) && !intentRequired.has(item))
  if (sensitive.length > 0) {
    return verdict(providerId, 'ask', risk, categories, `approval required for effects: ${sensitive.join(', ')}`, opinions)
  }
  const unrequested = effect.effects.filter(item => intentRequired.has(item) && !intent.allowedEffects.includes(item))
  if (unrequested.length > 0 || (effect.effects.some(item => intentRequired.has(item)) && effect.alignment !== 'aligned')) {
    return verdict(providerId, 'ask', risk, categories, `command effect was not independently established as requested: ${unrequested.join(', ') || 'intent unclear'}`, opinions)
  }
  return verdict(providerId, 'allow', risk, categories, 'independent intent and command-effect evidence permits this command', opinions)
}
