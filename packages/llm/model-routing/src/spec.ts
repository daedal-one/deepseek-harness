/**
 * Deployment configuration vocabulary for task classes: the schema a
 * composition validates against, and the checks a schema alone cannot state.
 *
 * @module @deepseek-ai/dsh-model-routing/spec
 */

import z from '@deepseek-ai/schemastery'
import type { TaskClassId, TaskClassSpec } from './types.ts'

/**
 * Validate and brand one task-class id.
 * @param value - candidate id.
 * @returns the validated id.
 * @throws {TypeError} when the value is not lowercase kebab-case.
 */
export function taskClassId(value: string): TaskClassId {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)) {
    throw new TypeError(`task class id "${value}" must be lowercase kebab-case`)
  }
  return value as TaskClassId
}

/** Schema of the hard capability requirements half of a class. */
const requirementsSchema = z.object({
  minContextTokens: z.number().step(1).min(1),
  requiresReasoning: z.boolean(),
  inputModalities: z.array(z.string().min(1)),
})

/** Schema of one operator preference tier. */
const preferenceTierSchema = z.object({
  name: z.string().min(1).required(),
  modelPatterns: z.array(z.string().min(1)).required(),
})

/** Schema of the token counts used to compare prices. */
const costBasisSchema = z.object({
  inputTokens: z.number().step(1).min(0).required(),
  outputTokens: z.number().step(1).min(0).required(),
})

/** Schema of one deployment-declared task class. */
export const TASK_CLASS_SPEC_SCHEMA: z<TaskClassSpec> = z.object({
  requirements: requirementsSchema,
  tiers: z.array(preferenceTierSchema).required(),
  costBasis: costBasisSchema,
})

/** Declared classes keyed by their validated id. */
export type TaskClassTable = Readonly<Record<string, TaskClassSpec>>

/**
 * Reject a class whose tiers cannot express a preference, or whose cost basis
 * prices nothing. These are the conditions a structural schema cannot state,
 * and each fails at load rather than resolving to an arbitrary route later.
 * @param id - the class id, named in every diagnostic.
 * @param spec - the declared class.
 * @throws {Error} naming the class and the exact offending field.
 */
function assertTaskClass(id: TaskClassId, spec: TaskClassSpec): void {
  if (spec.tiers.length === 0) {
    throw new Error(`task class "${String(id)}" must declare at least one preference tier`)
  }
  const names = new Set<string>()
  for (const tier of spec.tiers) {
    if (names.has(tier.name)) {
      throw new Error(`task class "${String(id)}" declares duplicate preference tier "${tier.name}"`)
    }
    names.add(tier.name)
    if (tier.modelPatterns.length === 0) {
      throw new Error(`task class "${String(id)}" tier "${tier.name}" must declare at least one model pattern`)
    }
  }
  if (spec.costBasis.inputTokens === 0 && spec.costBasis.outputTokens === 0) {
    throw new Error(`task class "${String(id)}" cost basis must price at least one token`)
  }
}

/**
 * Validate and brand every declared class.
 * @param classes - declared classes keyed by candidate id.
 * @returns the same classes keyed by validated id.
 * @throws {TypeError} for an id that is not lowercase kebab-case.
 * @throws {Error} for a class whose tiers or cost basis cannot express a preference.
 */
export function assertTaskClasses(classes: TaskClassTable): Readonly<Record<TaskClassId, TaskClassSpec>> {
  const validated: Record<TaskClassId, TaskClassSpec> = {}
  for (const [rawId, spec] of Object.entries(classes)) {
    const id = taskClassId(rawId)
    assertTaskClass(id, spec)
    validated[id] = spec
  }
  return validated
}
