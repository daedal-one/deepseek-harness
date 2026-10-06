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

/** Single actions use a tool name and plain arguments; fixed sequences and detailed programs remain supported. */
export const operationPlanParameters = {
  tool: { type: 'string', description: 'For one action: the exact tool name from the action catalog, for example read or bash. Supply arguments alongside it.' },
  arguments: { type: 'object', additionalProperties: true, description: 'For one action: its ordinary argument object. No plan or step wrappers are needed.' },
  goal: { type: 'string', description: 'Optional short purpose for the single action. Omit to run the action and return its result.' },
  plan: { description: 'Advanced alternative for a fixed sequence: {goal,steps:[{tool,arguments}]}. Do not combine with tool, arguments or goal. Limits can only be tightened, never raised.',
    oneOf: [simple, detailed] },
} as const satisfies ParameterSchemaSpec
