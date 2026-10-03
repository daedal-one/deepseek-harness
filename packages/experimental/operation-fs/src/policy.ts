/**
 * Host source admission and canonical completion checks for reviewed filesystem tools.
 * @module @deepseek-ai/dsh-experimental-operation-fs/policy
 */

import type { Context } from '@deepseek-ai/cordis'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { OperationToolPolicyError } from '@deepseek-ai/dsh-experimental-operation'
import type { OperationToolCallerContext, OperationToolInspection, OperationToolPolicy } from '@deepseek-ai/dsh-experimental-operation'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { Config } from './config.ts'

const HOST_WORLD = Symbol.for('@deepseek-ai/dsh/host-execution-world')

/**
 * Reject incompatible providers before any tools are contributed.
 * @param ctx Composition owning the actual filesystem and subprocess providers.
 */
export function requireHostWorld(ctx: Context): void {
  if (ctx.fs.executionWorld !== HOST_WORLD || ctx.subprocess.executionWorld !== HOST_WORLD) {
    throw new OperationToolPolicyError('operation-fs requires matching host filesystem and subprocess execution worlds')
  }
}

/**
 * Create independent argument and result checks for the three reviewed registrars.
 * @param ctx Composition whose providers execute the registered definitions.
 * @param config Validated immutable deployment bounds.
 * @returns Policies to bind to the exact definitions returned by production registrars.
 */
export function createFsPolicies(ctx: Context, config: Readonly<Config>): Readonly<Record<'read' | 'glob' | 'grep', OperationToolPolicy>> {
  requireHostWorld(ctx)
  const roots = config.approvedRoots.map(root => absolutePath(root, config.maxPathBytes, 'approved root'))
  const source = (value: JsonValue, caller: OperationToolCallerContext): void => {
    requireHostWorld(ctx)
    if (caller.cwd === undefined) throw new OperationToolPolicyError('operation-fs requires the actual caller session cwd')
    const cwd = absolutePath(caller.cwd, config.maxPathBytes, 'caller cwd')
    if (ctx.fs.processPathFromHostPath(cwd) !== cwd || ctx.subprocess.resolveWorkingDirectory(cwd) !== cwd) {
      throw new OperationToolPolicyError('operation-fs caller cwd does not agree with the provider working-directory mapping')
    }
    const path = pathText(value, config.maxPathBytes, 'source path')
    const target = resolve(cwd, path)
    if (!roots.some(root => contains(root, target))) {
      throw new OperationToolPolicyError('operation-fs source path is outside the approved roots')
    }
    if (ctx.fs.processPathFromHostPath(target) !== target) {
      throw new OperationToolPolicyError('operation-fs source path does not agree with the host filesystem mapping')
    }
  }
  const searchArguments = (value: JsonValue, caller: OperationToolCallerContext, grep: boolean): void => {
    const args = object(value, grep ? ['pattern', 'path', 'include'] : ['pattern', 'path'])
    boundedText(args.pattern, config.maxPatternBytes, 'pattern')
    if (!grep) globSyntax(args.pattern)
    if (args.include !== undefined) {
      boundedText(args.include, config.maxPatternBytes, 'include')
      globSyntax(args.include)
    }
    source(args.path === undefined ? '.' : args.path, caller)
  }
  return Object.freeze({
    read: Object.freeze({
      allowOutputReferences: true,
      validateArguments(value: JsonValue, caller: OperationToolCallerContext): void {
        const args = object(value, ['file_path', 'offset', 'limit'])
        source(required(args.file_path), caller)
        if (args.offset !== undefined && args.offset !== 1) {
          throw new OperationToolPolicyError('operation-fs read offset must be absent or 1 for whole-file evidence')
        }
        if (!positiveInteger(args.limit) || args.limit > config.readMaxLines) {
          throw new OperationToolPolicyError(`operation-fs read requires an explicit positive limit no greater than ${config.readMaxLines}`)
        }
      },
      inspectResult: inspectRead,
    }),
    glob: Object.freeze({
      allowOutputReferences: false,
      validateArguments: (value: JsonValue, caller: OperationToolCallerContext) => { searchArguments(value, caller, false) },
      inspectResult: inspectGlob,
    }),
    grep: Object.freeze({
      allowOutputReferences: false,
      validateArguments: (value: JsonValue, caller: OperationToolCallerContext) => { searchArguments(value, caller, true) },
      inspectResult: inspectGrep,
    }),
  })
}

function contains(root: string, target: string): boolean {
  const suffix = relative(root, target)
  return suffix === '' || (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix))
}

function boundedText(value: JsonValue | undefined, maxBytes: number, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.isWellFormed() || value.length === 0 || value.includes('\0') || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new OperationToolPolicyError(`operation-fs ${label} must be nonempty, NUL-free, well-formed Unicode within ${maxBytes} bytes`)
  }
}

function pathText(value: JsonValue, maxBytes: number, label: string): string {
  boundedText(value, maxBytes, label)
  const drive = /^[a-z]:[\\/]/i.test(value)
  const drivePrefixLength = drive ? 2 : 0
  if (value.trim().length === 0 || value.startsWith('~') || value.startsWith('//') || value.startsWith('\\\\')
    || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value)
    || (!drive && /^[a-z][a-z\d+.-]*:/i.test(value))
    || (drive && !isAbsolute(value))
    || (value.includes('\\') && sep !== '\\')
    || (value.includes(':', drivePrefixLength) && sep === '\\')
    || (isAbsolute(value) && !drive && sep === '\\')) {
    throw new OperationToolPolicyError(`operation-fs ${label} uses unsupported path syntax or parent traversal`)
  }
  return value
}

function absolutePath(value: string, maxBytes: number, label: string): string {
  const path = pathText(value, maxBytes, label)
  if (!isAbsolute(path) || resolve(path) !== path) {
    throw new OperationToolPolicyError(`operation-fs ${label} must be a canonical absolute host path`)
  }
  return path
}

function globSyntax(value: JsonValue | undefined): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.startsWith('!')
    || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value)) {
    throw new OperationToolPolicyError('operation-fs glob filters must be positive and contain no parent traversal')
  }
}

function object(value: JsonValue, keys: readonly string[]): Record<string, JsonValue> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OperationToolPolicyError('operation-fs expects a JSON object')
  }
  if (Object.keys(value).some(key => !keys.includes(key))) {
    throw new OperationToolPolicyError('operation-fs rejects unknown fields')
  }
  return value
}

function required(value: JsonValue | undefined): JsonValue {
  if (value === undefined) throw new OperationToolPolicyError('operation-fs required field is missing')
  return value
}

function positiveInteger(value: JsonValue | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function sourceText(value: JsonValue | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('\0')
}

function inspectRead(value: JsonValue): OperationToolInspection {
  return inspect(() => {
    const result = object(value, ['path', 'offset', 'lines', 'totalLines', 'truncatedByBytes', 'truncatedLineNumbers'])
    if (!sourceText(result.path) || !positiveInteger(result.offset)
      || typeof result.totalLines !== 'number' || !Number.isSafeInteger(result.totalLines) || result.totalLines < 0
      || !Array.isArray(result.lines) || typeof result.truncatedByBytes !== 'boolean' || !Array.isArray(result.truncatedLineNumbers)) {
      return failed('malformed canonical read facts')
    }
    const returned = new Set<number>()
    for (const [index, value] of result.lines.entries()) {
      const line = object(value, ['number', 'text'])
      if (!positiveInteger(line.number) || line.number !== result.offset + index
        || line.number > result.totalLines || typeof line.text !== 'string') return failed('malformed canonical read lines')
      returned.add(line.number)
    }
    const clipped = new Set<number>()
    for (const number of result.truncatedLineNumbers) {
      if (!positiveInteger(number) || !returned.has(number) || clipped.has(number)) return failed('malformed canonical read clipping facts')
      clipped.add(number)
    }
    if (result.offset !== 1 || result.lines.length !== result.totalLines || result.truncatedByBytes || clipped.size > 0) {
      return { kind: 'incomplete', reason: 'read does not contain complete unclipped whole-file evidence' }
    }
    return { kind: 'complete' }
  })
}

function inspectGlob(value: JsonValue): OperationToolInspection {
  return inspect(() => {
    const result = object(value, ['root', 'paths'])
    if (!sourceText(result.root) || !Array.isArray(result.paths) || !result.paths.every(sourceText)) {
      return failed('malformed canonical glob paths')
    }
    return { kind: 'complete' }
  })
}

function inspectGrep(value: JsonValue): OperationToolInspection {
  return inspect(() => {
    const result = object(value, ['matches'])
    if (!Array.isArray(result.matches)) return failed('malformed canonical grep matches')
    for (const value of result.matches) {
      const match = object(value, ['path', 'lineNumber', 'line'])
      if (!sourceText(match.path) || !positiveInteger(match.lineNumber) || typeof match.line !== 'string') {
        return failed('malformed canonical grep match')
      }
    }
    return { kind: 'complete' }
  })
}

function inspect(check: () => OperationToolInspection): OperationToolInspection {
  try {
    return check()
  } catch {
    // Canonical object validation rejects malformed JSON records; no tool work runs here.
    return failed('malformed canonical filesystem result')
  }
}

function failed(reason: string): OperationToolInspection {
  return { kind: 'failed', reason }
}
