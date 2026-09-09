/**
 * Role-aware status-block validation for completed one-shot subagents. The
 * provider checks textual compatibility formats and corroborates file claims
 * with the child's durable tool events when those facts are available.
 *
 * @module @deepseek-ai/dsh-subagent-result-status-block
 */

import { isAbsolute, normalize, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  SubagentResultValidationRequest,
  SubagentResultWarning,
} from '@deepseek-ai/dsh-subagent'

export const name = 'subagent-result-status-block'
export const inject = ['subagents']

/** Text protocol enforced by one validator instance. */
export interface Config {
  /** Unique name selected by `dsh-tool-subagent`. */
  validator: string
  /** Role protocol to validate. */
  kind: 'implementer-status' | 'review-verdict'
}

export const Config: z<Config> = z.object({
  validator: z.string().required(),
  kind: z.union(['implementer-status', 'review-verdict'] as const).required(),
})

const IMPLEMENTER_MARKERS = [
  'Status:',
  'Confidence:',
  'Spec issues:',
  'Deviations:',
  'Files:',
  'Verification:',
  'Commit:',
  'Warnings:',
] as const

/** Join the child's selected text blocks without interpreting attachments. */
function resultText(request: SubagentResultValidationRequest): string {
  return request.result.output
    .flatMap(block => block.type === 'text' ? [block.text] : [])
    .join('')
}

/** Normalize a reported path to the child's workspace when possible. */
function workspacePath(path: string, cwd: string | undefined): string {
  const unquoted = path.trim().replace(/^[`"']+|[`"']+$/g, '')
  if (cwd === undefined) return normalize(unquoted).replaceAll('\\', '/')
  const absolute = isAbsolute(unquoted) ? normalize(unquoted) : resolve(cwd, unquoted)
  const local = relative(cwd, absolute)
  return (local === '' ? '.' : local).replaceAll('\\', '/')
}

/** Parse one comma-delimited `Files:` line. */
function claimedFiles(text: string, cwd: string | undefined): string[] {
  const match = /^Files:\s*(.+)$/im.exec(text)
  if (match?.[1] === undefined || /^(?:none|n\/a)$/i.test(match[1].trim())) return []
  return match[1]
    .split(',')
    .map(path => workspacePath(path, cwd))
    .filter(path => path.length > 0)
}

/** Successful tool calls from the child's immutable session log. */
function successfulCalls(events: readonly SessionEvent[]): Array<Extract<SessionEvent, { type: 'tool/call' }>> {
  const succeeded = new Set(events.flatMap(event =>
    event.type === 'tool/result'
    && event.data.message.content[0].isError === false
      ? [event.data.message.source.callId]
      : []))
  return events.flatMap(event =>
    event.type === 'tool/call' && succeeded.has(event.data.callId) ? [event] : [])
}

/** Read a string path property from model-originated JSON arguments. */
function argumentPath(event: Extract<SessionEvent, { type: 'tool/call' }>): string | undefined {
  try {
    const value: unknown = JSON.parse(event.data.arguments)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const args = value as Record<string, unknown>
    for (const key of ['file_path', 'path', 'filePath']) {
      if (typeof args[key] === 'string' && args[key].trim().length > 0) return args[key]
    }
  } catch {
    // A malformed call never became a successful filesystem operation.
  }
  return undefined
}

/** Durable paths touched through known mutating filesystem tools. */
function observedMutations(request: SubagentResultValidationRequest): string[] {
  const child = request.run.localAgent
  if (child === undefined) return []
  const cwd = child.session.header.cwd
  const names = new Set(['write', 'edit', 'str_replace_editor'])
  return [...new Set(successfulCalls(child.session.snapshotEvents()).flatMap((event) => {
    if (!names.has(event.data.name)) return []
    const path = argumentPath(event)
    return path === undefined ? [] : [workspacePath(path, cwd)]
  }))].sort()
}

/** Durable paths inspected through known read-only filesystem tools. */
function observedReads(request: SubagentResultValidationRequest): string[] {
  const child = request.run.localAgent
  if (child === undefined) return []
  const cwd = child.session.header.cwd
  const names = new Set(['read', 'read_image'])
  return [...new Set(successfulCalls(child.session.snapshotEvents()).flatMap((event) => {
    if (!names.has(event.data.name)) return []
    const path = argumentPath(event)
    return path === undefined ? [] : [workspacePath(path, cwd)]
  }))].sort()
}

/** File references asserted by reviewer defect lines. */
function reviewerFileClaims(text: string, cwd: string | undefined): string[] {
  const claims: string[] = []
  for (const line of text.split('\n')) {
    const match = /^-\s+(.+?):\d+(?:\b|\s)/.exec(line)
    if (match?.[1] !== undefined) claims.push(workspacePath(match[1], cwd))
  }
  return [...new Set(claims)].sort()
}

/** Validate the imported implementer completion protocol. */
function validateImplementer(request: SubagentResultValidationRequest, text: string): SubagentResultWarning[] {
  if (request.role === 'guru' && /^Mode:\s*(?:ADVERSARIAL|PLAN)\b/m.test(text.slice(0, 400))) return []
  const warnings: SubagentResultWarning[] = []
  const missing = IMPLEMENTER_MARKERS.filter(marker => !text.includes(marker))
  if (missing.length > 0) {
    warnings.push({
      code: 'missing-status-fields',
      message: `The ${request.role} result is missing required status fields: ${missing.join(', ')}`,
      details: { missing: [...missing] },
    })
  }
  const claimed = new Set(claimedFiles(text, request.run.localAgent?.session.header.cwd))
  const unreported = observedMutations(request).filter(path => !claimed.has(path))
  if (unreported.length > 0) {
    warnings.push({
      code: 'unreported-file-mutations',
      message: `Durable child tool events show mutated paths absent from Files: ${unreported.join(', ')}`,
      details: { paths: unreported },
    })
  }
  return warnings
}

/** Validate the reviewer's verdict protocol and evidence-bearing file claims. */
function validateReviewer(request: SubagentResultValidationRequest, text: string): SubagentResultWarning[] {
  const warnings: SubagentResultWarning[] = []
  const verdict = /^Verdict:\s*(OK|DEFECTS)\s*$/im.exec(text)?.[1]?.toUpperCase()
  const missing = [
    verdict === undefined ? 'Verdict:' : undefined,
    /^Summary:\s*\S/im.test(text) ? undefined : 'Summary:',
    verdict === 'DEFECTS' && !/^Defects:\s*$/im.test(text) ? 'Defects:' : undefined,
  ].filter((value): value is string => value !== undefined)
  if (missing.length > 0) {
    warnings.push({
      code: 'invalid-review-verdict',
      message: `The reviewer result is missing required verdict fields: ${missing.join(', ')}`,
      details: { missing },
    })
  }
  const child = request.run.localAgent
  const claims = reviewerFileClaims(text, child?.session.header.cwd)
  const reads = new Set(observedReads(request))
  const unsupported = claims.filter(path => !reads.has(path))
  if (unsupported.length > 0) {
    warnings.push({
      code: 'unobserved-review-files',
      message: `Reviewer defect paths lack matching durable read events: ${unsupported.join(', ')}`,
      details: { paths: unsupported },
    })
  }
  return warnings
}

/**
 * Validate one completed result under a configured protocol.
 * @param kind - selected role protocol.
 * @param request - completed result and child evidence.
 * @returns structured warnings without replacing the child output.
 */
export function validateStatusBlock(
  kind: Config['kind'],
  request: SubagentResultValidationRequest,
): readonly SubagentResultWarning[] {
  const text = resultText(request)
  return kind === 'implementer-status'
    ? validateImplementer(request, text)
    : validateReviewer(request, text)
}

/**
 * Register one named status-block validator.
 * @param ctx - context carrying the subagent capability.
 * @param config - validator name and role protocol.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.subagents.registerResultValidator({
    name: config.validator,
    validate: request => Promise.resolve(validateStatusBlock(config.kind, request)),
  })
}
