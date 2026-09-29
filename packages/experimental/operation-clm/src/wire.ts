/**
 * Strict CLM System One choice-request and response wire validation.
 * @module @deepseek-ai/dsh-experimental-operation-clm/wire
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  canonicalJson,
  type OperationJudgmentDraft,
  type OperationJudgmentIdentity,
  type OperationJudgmentResponse,
  type OperationPreparedJudgment,
} from '@deepseek-ai/dsh-experimental-operation'

/**

 * Exact request vocabulary sent to the pinned CLM System One endpoint.

 */
export interface ClmChoiceRequest {
  readonly state: JsonValue
  readonly model: string
  readonly temperature: number
  readonly questions: {
    readonly transition: {
      readonly type: 'choice'
      readonly instructions: string
      readonly criteria: Readonly<Record<string, string>>
    }
  }
}

/**

 * CLM HTTP protocol validation failure.

 */
export class ClmWireError extends Error {
  /**
   * @param message Stable malformed-wire diagnostic.
   */
  constructor(message: string) {
    super(message)
    this.name = 'ClmWireError'
  }
}

/**

 * Build the complete request body from runner-owned state and choices.

 * @param draft Complete runner-owned request.

 * @param identity Locally pinned provider identity.

 * @param temperature Configured CLM softmax temperature.

 * @returns Exact System One choice request.

 */
export function clmChoiceRequest(
  draft: OperationJudgmentDraft,
  identity: OperationJudgmentIdentity,
  temperature: number,
): ClmChoiceRequest {
  const criteria: Record<string, string> = Object.create(null) as Record<string, string>
  for (const candidate of draft.candidates) criteria[candidate.id] = candidate.description
  const request: ClmChoiceRequest = {
    state: draft.state,
    model: identity.model,
    temperature,
    questions: {
      transition: {
        type: 'choice',
        instructions: draft.question,
        criteria,
      },
    },
  }
  return JSON.parse(canonicalJson(request as unknown as JsonValue)) as ClmChoiceRequest
}

/**

 * Serialize the exact outbound payload using the configured canonical recipe.

 * @param request CLM choice request.

 * @returns Canonical JSON bytes represented as text.

 */
export function serializeClmChoice(request: ClmChoiceRequest): string {
  return canonicalJson(request as unknown as JsonValue)
}

/**

 * Return every actual CLM encoder input for one choice request.

 * @param request Exact System One request.

 * @returns State-question text followed by each candidate text in wire order.

 */
export function clmEncoderInputs(request: ClmChoiceRequest): readonly string[] {
  const transition = request.questions.transition
  return [
    clmStateText(request.state, transition.instructions),
    ...Object.entries(transition.criteria).map(([key, description]) => clmText(description) || key),
  ]
}

/**

 * Render the state/question input exactly as the pinned CLM schema does.

 * @param state State wire value.

 * @param instructions Choice instructions.

 * @returns State-head encoder text.

 */
export function clmStateText(state: JsonValue, instructions: string): string {
  const renderedState = pythonStrip(clmText(state))
  const renderedInstructions = pythonStrip(clmText(instructions))
  return renderedState && renderedInstructions
    ? `${renderedState}\n\n${renderedInstructions}`
    : renderedState || renderedInstructions
}

/**

 * Parse and validate a complete System One response.

 * @param raw JSON-decoded HTTP body.

 * @param prepared Exact recorded request.

 * @param identity Locally pinned provider identity.

 * @returns Validated response associated with local request and identity.

 */
export function parseClmChoiceResponse(
  raw: unknown,
  prepared: OperationPreparedJudgment,
  identity: OperationJudgmentIdentity,
): OperationJudgmentResponse {
  const record = object(raw, 'CLM response')
  exact(record, ['model', 'answers', 'usage'], 'CLM response')
  if (string(record.model, 'CLM response.model') !== identity.model) {
    throw new ClmWireError('CLM response model does not match configured model')
  }
  const answers = object(record.answers, 'CLM response.answers')
  exact(answers, ['transition'], 'CLM response.answers')
  const transition = object(answers.transition, 'CLM response.answers.transition')
  exact(transition, ['type', 'choice', 'confidence', 'probabilities'], 'CLM response.answers.transition')
  if (transition.type !== 'choice') throw new ClmWireError('CLM response.answers.transition.type must equal choice')
  const probabilities = probabilityMap(transition.probabilities, prepared)
  const choice = string(transition.choice, 'CLM response.answers.transition.choice')
  if (!Object.hasOwn(probabilities, choice)) throw new ClmWireError('CLM response choice must name a supplied candidate')
  const confidence = probability(transition.confidence, 'CLM response.answers.transition.confidence')
  const top = Math.max(...Object.values(probabilities))
  if (probabilities[choice] !== top) throw new ClmWireError('CLM response choice must name a highest-probability candidate')
  const usage = parseUsage(record.usage)
  return {
    requestId: prepared.draft.id,
    identity,
    probabilities,
    usage,
    providerConfidence: confidence,
    wire: record as JsonValue,
  }
}

function probabilityMap(raw: unknown, prepared: OperationPreparedJudgment): Readonly<Record<string, number>> {
  const record = object(raw, 'CLM response.answers.transition.probabilities')
  const expected = new Set<string>(prepared.draft.candidates.map(candidate => candidate.id))
  const keys = Object.keys(record)
  if (keys.length !== expected.size || keys.some(key => !expected.has(key))) {
    throw new ClmWireError('CLM response probabilities must cover exactly the supplied criteria')
  }
  const probabilities: Record<string, number> = Object.create(null) as Record<string, number>
  let sum = 0
  for (const key of keys) {
    const value = probability(record[key], `CLM probability for ${JSON.stringify(key)}`)
    probabilities[key] = value
    sum += value
  }
  if (Math.abs(sum - 1) > 1e-6) throw new ClmWireError('CLM probabilities must sum to one')
  return probabilities
}

function parseUsage(raw: unknown): { readonly billingUnits: number; readonly inputTokens: number; readonly outputTokens: number } {
  const record = object(raw, 'CLM response.usage')
  exact(record, ['billing_units', 'input_tokens', 'output_tokens'], 'CLM response.usage')
  const billingUnits = safeNonNegative(record.billing_units, 'CLM response.usage.billing_units')
  const inputTokens = safeNonNegative(record.input_tokens, 'CLM response.usage.input_tokens')
  const outputTokens = safeNonNegative(record.output_tokens, 'CLM response.usage.output_tokens')
  if (billingUnits !== 1) throw new ClmWireError('CLM response.usage.billing_units must equal the single supplied question')
  if (outputTokens !== 0) throw new ClmWireError('CLM response.usage.output_tokens must equal zero for System One')
  return { billingUnits, inputTokens, outputTokens }
}

function clmText(value: JsonValue, indent = 0): string {
  if (value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return pythonNumberText(value)
  const pad = ' '.repeat(indent)
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if ((Array.isArray(entry) || isRecord(entry)) && nonEmpty(entry)) return `${pad}-\n${clmText(entry, indent + 2)}`
      return `${pad}- ${clmText(entry)}`
    }).join('\n')
  }
  return Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, entry]) => {
    if ((Array.isArray(entry) || isRecord(entry)) && nonEmpty(entry)) return `${pad}${key}:\n${clmText(entry, indent + 2)}`
    return `${pad}${key}: ${clmText(entry)}`
  }).join(indent === 0 ? '\n\n' : '\n')
}

// Python str.strip follows Unicode White_Space plus U+001C–U+001F, not ECMAScript trim (which removes U+FEFF).
function pythonStrip(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && pythonWhitespace(value.charCodeAt(start))) start += 1
  while (end > start && pythonWhitespace(value.charCodeAt(end - 1))) end -= 1
  return value.slice(start, end)
}

function pythonWhitespace(code: number): boolean {
  return (code >= 0x09 && code <= 0x0d) || (code >= 0x1c && code <= 0x20)
    || code === 0x85 || code === 0xa0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a)
    || code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000
}

function pythonNumberText(value: number): string {
  const json = JSON.stringify(value)
  if (!json.includes('.') && !json.includes('e')) return json
  const absolute = Math.abs(value)
  if (absolute === 0 || (absolute >= 1e-4 && absolute < 1e16)) return String(value)
  const exponential = value.toExponential()
  const [coefficient, rawExponent] = exponential.split('e')
  if (coefficient === undefined || rawExponent === undefined) return exponential
  const sign = rawExponent.startsWith('-') ? '-' : '+'
  const digits = rawExponent.replace(/^[+-]/u, '').padStart(2, '0')
  return `${coefficient}e${sign}${digits}`
}

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmpty(value: JsonValue[] | { [key: string]: JsonValue }): boolean {
  return Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ClmWireError(`${path} must be an object`)
  return value as Record<string, unknown>
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new ClmWireError(`${path} must be a non-empty string`)
  return value
}

function probability(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ClmWireError(`${path} must be finite within [0, 1]`)
  }
  return value
}

function safeNonNegative(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new ClmWireError(`${path} must be a non-negative safe integer`)
  return value
}

function exact(record: Record<string, unknown>, keys: readonly string[], path: string): void {
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) throw new ClmWireError(`${path} has unsupported field ${JSON.stringify(key)}`)
  }
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) throw new ClmWireError(`${path} is missing required field ${JSON.stringify(key)}`)
  }
}
