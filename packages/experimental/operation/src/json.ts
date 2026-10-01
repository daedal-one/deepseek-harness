/**
 * Canonical JSON identity, byte limits, and RFC 6901 pointer resolution.
 * @module @deepseek-ai/dsh-experimental-operation/json
 */

import { createHash } from 'node:crypto'
import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'

/**

 * One successful JSON Pointer lookup.

 */
export interface JsonPointerFound {
  readonly found: true
  readonly value: JsonValue
}

/**

 * One missing JSON Pointer lookup, distinct from an explicit `null` value.

 */
export interface JsonPointerMissing {
  readonly found: false
}

/**

 * JSON Pointer lookup result preserving missing-versus-null semantics.

 */
export type JsonPointerResult = JsonPointerFound | JsonPointerMissing

/**

 * Return a recursively key-sorted lossless JSON representation.

 * @param value JSON value to serialize.

 * @returns Canonical JSON text.

 */
export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => {
      const nested = value[key]
      if (nested === undefined) throw new OperationJsonError(`JSON object has undefined property ${JSON.stringify(key)}`)
      return `${JSON.stringify(key)}:${canonicalJson(nested)}`
    }).join(',')}}`
  }
  return JSON.stringify(value)
}

/**

 * Hash canonical JSON with SHA-256.

 * @param value JSON value to identify.

 * @returns Lowercase hexadecimal digest.

 */
export function digestJson(value: JsonValue): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

/**

 * Measure UTF-8 bytes of canonical JSON.

 * @param value JSON value to measure.

 * @returns UTF-8 byte length.

 */
export function jsonBytes(value: JsonValue): number {
  return Buffer.byteLength(canonicalJson(value), 'utf8')
}

/**

 * Detach arbitrary lossless JSON or throw at a parser boundary.

 * @param value Candidate value.

 * @param label Diagnostic label.

 * @returns Detached JSON value.

 */
export function requireJson(value: unknown, label: string): JsonValue {
  const snapshot = snapshotJsonValue(value) as JsonValue | undefined
  if (snapshot === undefined) throw new OperationJsonError(`${label} must be losslessly JSON-serializable`)
  return snapshot
}

/**

 * Operation parser failure for malformed JSON structural input.

 */
export class OperationJsonError extends Error {
  /**
   * @param message Stable boundary failure detail.
   */
  constructor(message: string) {
    super(message)
    this.name = 'OperationJsonError'
  }
}

/**

 * Parse one RFC 6901 pointer into decoded segments.

 * @param pointer Pointer string.

 * @returns Decoded segment sequence.

 */
export function parseJsonPointer(pointer: string): readonly string[] {
  if (pointer === '') return []
  if (!pointer.startsWith('/')) throw new OperationJsonError(`JSON Pointer must be empty or start with "/", got ${JSON.stringify(pointer)}`)
  return pointer.slice(1).split('/').map((segment) => {
    let decoded = ''
    for (let index = 0; index < segment.length; index += 1) {
      const char = segment[index]
      if (char === undefined) throw new OperationJsonError(`JSON Pointer has invalid escape in ${JSON.stringify(pointer)}`)
      if (char !== '~') {
        decoded += char
        continue
      }
      const escaped = segment[index + 1]
      if (escaped === '0') decoded += '~'
      else if (escaped === '1') decoded += '/'
      else throw new OperationJsonError(`JSON Pointer has invalid escape in ${JSON.stringify(pointer)}`)
      index += 1
    }
    return decoded
  })
}

/**

 * Resolve one JSON Pointer without coercion or prototype traversal.

 * @param value JSON root.

 * @param pointer RFC 6901 pointer.

 * @returns Found value or explicit absence.

 */
export function resolveJsonPointer(value: JsonValue, pointer: string): JsonPointerResult {
  let current: JsonValue = value
  for (const segment of parseJsonPointer(pointer)) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/u.test(segment)) return { found: false }
      const index = Number(segment)
      if (!Number.isSafeInteger(index) || index >= current.length) return { found: false }
      const item = current[index]
      if (item === undefined) return { found: false }
      current = item
      continue
    }
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, segment)) return { found: false }
    const property = current[segment]
    if (property === undefined) return { found: false }
    current = property
  }
  return { found: true, value: current }
}

/**

 * Compare two lossless JSON values by canonical representation.

 * @param left First JSON value.

 * @param right Second JSON value.

 * @returns Whether values are structurally identical.

 */
export function equalJson(left: JsonValue, right: JsonValue): boolean {
  return canonicalJson(left) === canonicalJson(right)
}
