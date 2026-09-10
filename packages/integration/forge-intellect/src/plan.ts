/** Versioned retained plans; every execution input is shown before approval. */
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { canonical } from './bridge.ts'

const text = z.string().min(1)
/** Required deterministic check proposed for approval. */
export const checkSchema = z.object({
  id: text.regex(/^[a-z][a-z0-9-]*$/),
  argv: z.array(text).min(1),
  obligations: z.array(text).min(1),
  timeout_seconds: z.number().int().min(1).max(3600),
  success_markers: z.array(text).min(1),
  failure_markers: z.array(text),
}).strict()
/** Exact provider route retained in a plan. */
export const selectionSchema = z.object({ provider: text, model: text, reasoningEffort: text.optional() }).strict()
/** Model-proposed execution inputs validated before preparation. */
export const planInputSchema = z.object({
  subjects: z.array(text).min(1), source_paths: z.array(text), checks: z.array(checkSchema).min(1) }).strict()
/** Proposed subjects, sources and checks. */
export type PlanInput = z.infer<typeof planInputSchema>
/** Native fixed-check policy without generated probes. */
export const policySchema = z.object({
  schema: z.literal('forge-intellect-verification-policy/v1'), id: text,
  subjects: z.array(text).min(1), source_paths: z.array(text),
  checks: z.array(checkSchema.extend({ required: z.literal(true) })),
  command_environment: z.record(text, z.string()), command_wrapper: z.array(z.string()),
  generated_test_prefixes: z.array(z.string()), max_probes: z.literal(0),
  max_context_bytes: z.number().int().positive(),
  agent_timeout_seconds: z.number().int().positive(), run_timeout_seconds: z.number().int().positive(),
}).strict()
/** Content-addressed local execution plan. */
export const planSchema = z.object({
  schema: z.literal('deadal-intellect-plan/v1'), id: z.uuid(), digest: text,
  repository: text, revision: text.regex(/^[a-f0-9]{40}([a-f0-9]{24})?$/),
  policy: policySchema,
  reviewers: z.object({ assessor: selectionSchema, challenger: selectionSchema }).strict(),
  maxTokens: z.number().int().positive(),
}).strict()
/** Approved-input candidate retained with its content digest. */
export type Plan = z.infer<typeof planSchema>
/** Retained execution record; assessment remains native-owned. */
export const runSchema = z.object({
  schema: z.literal('deadal-intellect-run/v1'), id: z.uuid(), plan: z.uuid(), repository: text,
  source: z.uuid().optional(), createdAt: z.number().int().nonnegative(), state: z.enum(['running', 'completed', 'failed', 'cancelled', 'interrupted']), error: z.string().optional(),
}).strict()
/** Local execution lifecycle and immutable native-run reference. */
export type RunRecord = z.infer<typeof runSchema>

/** Hash every plan field except the self-referential digest.
 * @param plan - proposed or retained plan.
 * @returns SHA-256 identity over all execution inputs.
 */
export function planDigest(plan: Omit<Plan, 'digest'> | Plan): string {
  const { digest: _digest, ...body } = { digest: '', ...plan }
  return createHash('sha256').update(canonical(body)).digest('hex')
}

/** Validate both persisted shape and content identity before acting.
 * @param value - untrusted retained JSON.
 * @returns Validated plan, or throws on alteration.
 */
export function readPlan(value: unknown): Plan {
  const plan = planSchema.parse(value)
  if (plan.digest !== planDigest(plan)) throw new Error('Verification plan changed; prepare and approve a new plan')
  return plan
}
