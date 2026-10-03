/**
 * Explicit standalone host read-only composition of reviewed production tools.
 * @module @deepseek-ai/dsh-experimental-operation-fs
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-experimental-operation'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { applyReadTool } from '@deepseek-ai/dsh-tool-fs'
import { applyGlobTool, applyGrepTool } from '@deepseek-ai/dsh-tool-fs-search'
import { resolveConfig, type Config } from './config.ts'
import { createFsPolicies } from './policy.ts'

export { Config } from './config.ts'

/** Cordis plugin name for the explicit read-only composition. */
export const name = 'experimental-operation-fs'

/** Ordinary services shared by the exact registered tools and their operation policies. */
export const inject = ['operations', 'tools', 'systemPrompt', 'fs', 'subprocess']

/**
 * Mount read, glob, and grep once at normal global scope with owned operation policies.
 * The ordinary registry rejects duplicate names; this plugin neither looks up existing
 * definitions nor creates scoped replacements for them.
 * @param ctx Standalone composition context, not an agent scope.
 * @param config Explicit approved source roots and workload bounds.
 */
export function apply(ctx: Context, config: Config): void {
  if (scopeOf(ctx) !== undefined) throw new Error('operation-fs must be mounted at global scope, never as scoped shadow tools')
  const resolved = resolveConfig(config)
  const policies = createFsPolicies(ctx, resolved)
  const read = applyReadTool(ctx, {
    limit: resolved.readMaxLines,
    maxLineLength: resolved.readMaxLineLength,
    maxBytes: resolved.readMaxBytes,
    streamMinSize: resolved.readStreamMinSize,
  })
  ctx.effect(() => ctx.operations.toolPolicies.register(read, policies.read))
  const search = {
    maxMetaBytes: resolved.searchMetaMaxBytes,
    rawOutputMaxBytes: resolved.rawOutputMaxBytes,
    graceMs: resolved.graceMs,
    stderrMaxBytes: resolved.stderrMaxBytes,
    timeoutMs: resolved.timeoutMs,
  }
  const glob = applyGlobTool(ctx, {
    ...search,
    maxResults: resolved.globMaxResults,
    sampleOverCapGlobResults: resolved.sampleOverCapGlobResults,
  })
  ctx.effect(() => ctx.operations.toolPolicies.register(glob, policies.glob))
  const grep = applyGrepTool(ctx, {
    ...search,
    maxMatches: resolved.grepMaxMatches,
    maxLineBytes: resolved.grepMaxLineBytes,
  })
  ctx.effect(() => ctx.operations.toolPolicies.register(grep, policies.grep))
}
