/**
 * Canonical observation extraction and coherent complete-action construction.
 * @module @deepseek-ai/dsh-experimental-operation/observation
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { canonicalJson, jsonBytes, resolveJsonPointer } from './json.ts'
import { resolveOperationExpression } from './resolution.ts'
import type {
  OperationActionCandidate,
  OperationCandidateId,
  OperationExpression,
  OperationObservation,
  OperationStep,
} from './types.ts'
import type { OperationResolutionContext } from './resolution.ts'

/**

 * Observation or candidate construction could not preserve complete bounded evidence.

 */
export class OperationEvidenceError extends Error {
  /**
   * @param message Stable evidence insufficiency detail.
   */
  constructor(message: string) {
    super(message)
    this.name = 'OperationEvidenceError'
  }
}

/**

 * Extract all declared complete JSON evidence without rendering or parsing tool display text.

 * @param step Successful producing step.

 * @param value Canonical post-policy result.

 * @param maxBytes Deployment observation cap.

 * @returns Exact observation values with provenance.

 */
export function observeCanonicalResult(step: OperationStep, value: JsonValue, maxBytes: number): readonly OperationObservation[] {
  const pointers = [...step.observation.paths]
  if (step.observation.candidates !== undefined
    && !pointers.includes(step.observation.candidates)) {
    pointers.push(step.observation.candidates)
  }
  const observations: OperationObservation[] = pointers.map((pointer) => {
    const resolved = resolveJsonPointer(value, pointer)
    if (!resolved.found) throw new OperationEvidenceError(`step ${JSON.stringify(step.id)} is missing declared observation ${JSON.stringify(pointer)}`)
    return { step: step.id, pointer, value: resolved.value }
  })
  if (jsonBytes(observations as unknown as JsonValue) > maxBytes) {
    throw new OperationEvidenceError(`step ${JSON.stringify(step.id)} observation exceeds ${maxBytes} bytes`)
  }
  return observations
}

/**

 * Build every coherent next action from one selected record collection or fixed values.

 * @param current Successful producing step.

 * @param next Fixed immediate following step.

 * @param result Canonical current result.

 * @param context Completed inputs/results.

 * @param maxCandidates Deployment candidate cap.

 * @param maxCandidateBytes Deployment per-candidate cap.

 * @returns Closed continuation candidates without runner-owned stop choices.

 */
export function buildContinuationCandidates(
  current: OperationStep,
  next: OperationStep,
  result: JsonValue,
  context: OperationResolutionContext,
  maxCandidates: number,
  maxCandidateBytes: number,
): readonly OperationActionCandidate[] {
  const selected = selectedStep(next.arguments)
  const sources = selected === undefined
    ? [undefined]
    : candidateRecords(current, result, maxCandidates)
  if (sources.length > maxCandidates) throw new OperationEvidenceError(`step ${JSON.stringify(current.id)} candidate collection exceeds ${maxCandidates} records`)
  const candidates: OperationActionCandidate[] = []
  for (const [index, source] of sources.entries()) {
    const resolved = source === undefined
      ? resolveOperationExpression(next.arguments, context)
      : resolveOperationExpression(next.arguments, { ...context, selected: new Map([[current.id, source.value]]) })
    const id = `continue-${index}` as OperationCandidateId
    const description = actionDescription(next, resolved.value, source)
    if (Buffer.byteLength(description, 'utf8') > maxCandidateBytes) {
      throw new OperationEvidenceError(`candidate ${JSON.stringify(id)} exceeds ${maxCandidateBytes} bytes`)
    }
    candidates.push({
      id,
      kind: 'continue',
      nextStep: next.id,
      arguments: resolved.value,
      ...(source === undefined ? {} : { source }),
      description,
    })
  }
  return candidates
}

/**

 * Build runner-owned intermediate stop controls.

 * @param candidates Continuation candidates.

 * @returns Closed action set with replan and stop controls.

 */
export function withIntermediateControls(candidates: readonly OperationActionCandidate[]): readonly OperationActionCandidate[] {
  return [
    ...candidates,
    { id: 'needs-replan' as OperationCandidateId, kind: 'needs-replan', description: 'Return control to the planner because no supplied next action has sufficient support.' },
    { id: 'stop' as OperationCandidateId, kind: 'stop', description: 'Stop this operation because continuing contradicts the goal or observed evidence.' },
  ]
}

/**

 * Build runner-owned final controls after declared completion assertions pass.

 * @returns Closed completion action set.

 */
export function completionControls(): readonly OperationActionCandidate[] {
  return [
    { id: 'complete' as OperationCandidateId, kind: 'complete', description: 'Complete the operation because all declared verification checks passed and the evidence supports the goal.' },
    { id: 'needs-replan' as OperationCandidateId, kind: 'needs-replan', description: 'Return control to the planner because declared checks do not establish semantic completion.' },
    { id: 'stop' as OperationCandidateId, kind: 'stop', description: 'Stop because the observed evidence contradicts completion.' },
  ]
}

function candidateRecords(step: OperationStep, result: JsonValue, maxCandidates: number): OperationObservation[] {
  const pointer = step.observation.candidates
  if (pointer === undefined) throw new OperationEvidenceError(`step ${JSON.stringify(step.id)} has selected next-step expressions without observation.candidates`)
  const resolved = resolveJsonPointer(result, pointer)
  if (!resolved.found) throw new OperationEvidenceError(`step ${JSON.stringify(step.id)} is missing candidate collection ${JSON.stringify(pointer)}`)
  if (!Array.isArray(resolved.value)) throw new OperationEvidenceError(`step ${JSON.stringify(step.id)} candidate collection must be an array`)
  if (resolved.value.length === 0) throw new OperationEvidenceError(`step ${JSON.stringify(step.id)} candidate collection is empty`)
  if (resolved.value.length > maxCandidates) throw new OperationEvidenceError(`step ${JSON.stringify(step.id)} candidate collection exceeds ${maxCandidates} records`)
  return resolved.value.map((value, index) => ({ step: step.id, pointer: `${pointer}/${index}`, value }))
}

function selectedStep(expression: OperationExpression): string | undefined {
  const found = new Set<string>()
  const visit = (current: OperationExpression): void => {
    switch (current.kind) {
      case 'selected':
        found.add(current.step)
        return
      case 'object':
        for (const nested of Object.values(current.properties)) visit(nested)
        return
      case 'array':
        for (const nested of current.items) visit(nested)
        return
      case 'literal':
      case 'input':
      case 'result':
        return
      default:
        return unreachable(current)
    }
  }
  visit(expression)
  if (found.size > 1) throw new OperationEvidenceError('one continuation may select only one complete record collection')
  return [...found][0]
}

function actionDescription(step: OperationStep, argumentsValue: JsonValue, source: OperationObservation | undefined): string {
  const selection = source === undefined ? '' : ` Selected evidence from ${source.step}${source.pointer}: ${canonicalJson(source.value)}.`
  return `Run ${step.tool} for ${step.purpose}. Complete arguments: ${canonicalJson(argumentsValue)}.${selection}`
}

function unreachable(value: never): never {
  throw new OperationEvidenceError(`unsupported expression variant: ${JSON.stringify(value)}`)
}
