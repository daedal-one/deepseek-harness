/**
 * Branded durable operation identifiers.
 * @module @deepseek-ai/dsh-experimental-operation/ids
 */

import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identity of one immutable operation run. */
export type OperationRunId = Branded<'OperationRunId'>
/** Opaque identity of one provider request within an operation run. */
export type OperationJudgmentRequestId = Branded<'OperationJudgmentRequestId'>
/** Opaque identity of one supplied ranking choice. */
export type OperationCandidateId = Branded<'OperationCandidateId'>

/**
 * Brand one operation-run identifier.
 * @param value Raw identifier.
 * @returns Branded operation-run identifier.
 */
export function OperationRunId(value: string): OperationRunId {
  return brandString<OperationRunId>(value)
}

/**
 * Brand one operation judgment request identifier.
 * @param value Raw identifier.
 * @returns Branded judgment request identifier.
 */
export function OperationJudgmentRequestId(value: string): OperationJudgmentRequestId {
  return brandString<OperationJudgmentRequestId>(value)
}

/**
 * Brand one operation candidate identifier.
 * @param value Raw identifier.
 * @returns Branded operation candidate identifier.
 */
export function OperationCandidateId(value: string): OperationCandidateId {
  return brandString<OperationCandidateId>(value)
}
