/** Model-facing operation syntax; the plan parser owns recursive and semantic checks. @module dsh-experimental-operation/plan-schema */

import type { ParameterSchemaSpec, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { OperationLimits } from './types.ts'

const pointer = { type: 'string', required: true, description: 'JSON Pointer; use "" for the whole value.' } as const
const expression = {
  description: 'A tagged expression. Wrap fixed tool arguments as {kind:"literal",value:{...}}; raw argument objects are invalid.',
  oneOf: [
    { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', required: true, const: 'literal' }, value: { type: 'json', required: true },
    } },
    { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', required: true, const: 'input' }, input: { type: 'string', required: true }, pointer,
    } },
    { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', required: true, const: 'result' }, step: { type: 'string', required: true }, pointer,
    } },
    { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', required: true, const: 'selected' }, step: { type: 'string', required: true }, pointer,
    } },
    { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', required: true, const: 'object' },
      properties: { type: 'object', additionalProperties: true, required: true,
        description: 'Named expressions, recursively using these same six kinds; each value must be an expression.' },
    } },
    { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', required: true, const: 'array' },
      items: { type: 'array', required: true, items: { type: 'json', description: 'An expression, recursively using these same six kinds.' } },
    } },
  ],
} as const satisfies ValueSchemaSpec

const assertion = {
  description: 'A mandatory deterministic check. number/size require min or max; min must not exceed max.',
  oneOf: [
    { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', required: true, const: 'present' }, value: { ...expression, required: true },
    } },
    { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', required: true, const: 'type' }, value: { ...expression, required: true },
      type: { type: 'string', required: true, enum: ['null', 'boolean', 'number', 'string', 'array', 'object'] },
    } },
    { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', required: true, const: 'equals' },
      left: { ...expression, required: true }, right: { ...expression, required: true },
    } },
    { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', required: true, const: 'oneOf' }, value: { ...expression, required: true },
      values: { type: 'array', required: true, items: { type: 'json' }, description: 'Nonempty allowed literal JSON values.' },
    } },
    { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', required: true, enum: ['number', 'size'] }, value: { ...expression, required: true },
      min: { type: 'number' }, max: { type: 'number' },
    } },
  ],
} as const satisfies ValueSchemaSpec

const limitProperties = {
  maxPlanBytes: { type: 'integer' }, maxSteps: { type: 'integer' }, maxWallMs: { type: 'integer' },
  maxToolDeadlineMs: { type: 'integer' }, maxJudgmentDeadlineMs: { type: 'integer' },
  maxToolCalls: { type: 'integer' }, maxJudgments: { type: 'integer' }, maxResultBytes: { type: 'integer' },
  maxObservationBytes: { type: 'integer' }, maxCandidates: { type: 'integer' }, maxCandidateBytes: { type: 'integer' },
  maxJudgmentInputTokens: { type: 'integer' }, maxJudgmentOutputTokens: { type: 'integer' },
  minimumProbability: { type: 'number' }, minimumMargin: { type: 'number' }, requireCalibration: { type: 'boolean' },
} as const satisfies Record<keyof OperationLimits, ValueSchemaSpec>

/** Required plan fields and tagged alternatives projected through the existing tool-schema vocabulary. */
export const operationPlanParameters = {
  plan: {
    type: 'object', additionalProperties: false, required: true,
    description: 'A short finite plan. Use version:1, inputs:{} when unnecessary, and the fewest steps needed for the requested facts. All collections marked nonempty require at least one item.',
    properties: {
      version: { type: 'integer', required: true, const: 1 },
      name: { type: 'string', required: true, description: 'Nonempty short plan name.' },
      goal: { type: 'string', required: true, description: 'The specific evidence or effect this bounded plan must establish.' },
      inputs: { type: 'object', additionalProperties: true, required: true, description: 'Named literal JSON inputs; use {} for fixed arguments.' },
      steps: {
        type: 'array', required: true, description: 'Nonempty fixed sequential actions. References in arguments point backward only.',
        items: { type: 'object', additionalProperties: false, properties: {
          id: { type: 'string', required: true, description: 'Nonempty unique step id.' },
          purpose: { type: 'string', required: true }, tool: { type: 'string', required: true, description: 'Exact admitted action name from the catalog.' },
          arguments: { ...expression, required: true },
          assertions: { type: 'array', required: true, items: assertion, description: 'Nonempty checks; result expressions may refer to this step.' },
          observation: { type: 'object', additionalProperties: false, required: true, properties: {
            paths: { type: 'array', required: true, items: { type: 'string' }, description: 'Nonempty unique JSON Pointers into the canonical result. Select only necessary complete evidence.' },
            candidates: { type: 'string', description: 'Optional JSON Pointer to complete candidate records for the next action.' },
          } },
          question: { type: 'string', required: true, description: 'Can the observed facts support this specific step or next action?' },
        } },
      },
      completion: { type: 'object', additionalProperties: false, required: true, properties: {
        assertions: { type: 'array', required: true, items: assertion, description: 'Nonempty deterministic checks of the plan outcome.' },
        evidence: { type: 'array', required: true, items: expression, description: 'Nonempty complete evidence expressions for this bounded goal.' },
        question: { type: 'string', required: true, description: 'Do these facts establish the bounded plan goal?' },
      } },
      requestedLimits: { type: 'object', additionalProperties: false, properties: limitProperties,
        description: 'Optional tighter deployment limits. Maxima are positive safe integers; probabilities are within [0,1]. Cannot increase budgets or relax acceptance.' },
    },
  },
} as const satisfies ParameterSchemaSpec
