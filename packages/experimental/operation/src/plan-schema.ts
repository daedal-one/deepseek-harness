/**
 * Concise requests and detailed programs with resolver-owned semantic validation.
 * @module dsh-experimental-operation/plan-schema
 */

import type { ParameterSchemaSpec, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

const requestedLimits = { type: 'object', additionalProperties: true,
  description: 'Optional tighter deployment limits; the resolver validates names and values. Omit for normal use.' } as const

const simple = {
  type: 'object', additionalProperties: false,
  properties: {
    goal: { type: 'string', required: true, description: 'What this short operation should establish or accomplish.' },
    steps: { type: 'array', required: true, description: 'Nonempty fixed actions in order. Start with one action when sufficient.',
      items: { type: 'object', additionalProperties: false, properties: {
        tool: { type: 'string', required: true, description: 'Exact admitted tool name.' },
        arguments: { type: 'object', additionalProperties: true, required: true, description: 'Ordinary tool arguments, exactly as the action schema declares them.' },
        observe: { type: 'array', items: { type: 'string' }, description: 'Optional nonempty JSON Pointer list selecting complete necessary evidence. Omit to observe the complete canonical result.' },
      } },
    },
    requestedLimits,
  },
} as const satisfies ValueSchemaSpec

const detailed = {
  type: 'object', additionalProperties: false,
  description: 'Detailed version-one program for typed references or custom assertions. Use the concise form for ordinary actions; detailed fields require strict expression and assertion syntax.',
  properties: {
    version: { type: 'integer', required: true, const: 1 },
    name: { type: 'string', required: true },
    goal: { type: 'string', required: true },
    inputs: { type: 'object', additionalProperties: true, required: true },
    steps: { type: 'array', required: true, items: { type: 'json' } },
    completion: { type: 'object', additionalProperties: true, required: true },
    requestedLimits,
  },
} as const satisfies ValueSchemaSpec

/** Ordinary actions need only a goal and plain tool arguments; detailed programs remain supported. */
export const operationPlanParameters = {
  plan: { required: true, description: 'Prefer {goal,steps:[{tool,arguments}]}. The harness supplies execution bookkeeping, checks and semantic checkpoints.',
    oneOf: [simple, detailed] },
} as const satisfies ParameterSchemaSpec
