/**
 * Explicit deployment bounds for the read-only operation composition.
 * @module @deepseek-ai/dsh-experimental-operation-fs/config
 */

import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Every bound is deployment-owned; this composition supplies no workload defaults. */
export interface Config {
  /** Absolute host roots admitting source paths, not a symlink-safe read fence. */
  approvedRoots: string[]
  /** Maximum UTF-8 bytes in each source path. */
  maxPathBytes: number
  /** Maximum UTF-8 bytes in each glob, regular expression, or include filter. */
  maxPatternBytes: number
  /** Maximum explicit read limit, also the normal read tool's line cap. */
  readMaxLines: number
  /** Maximum UTF-16 code units returned for one read line. */
  readMaxLineLength: number
  /** Maximum UTF-8 bytes returned for selected read lines. */
  readMaxBytes: number
  /** File size at which the normal read tool streams instead of buffering. */
  readStreamMinSize: number
  /** Maximum glob paths displayed; canonical results remain complete. */
  globMaxResults: number
  /** Whether an over-cap glob display samples top-level entries. */
  sampleOverCapGlobResults: boolean
  /** Maximum grep matches displayed; canonical results remain complete. */
  grepMaxMatches: number
  /** Maximum bytes in a grep line preview; canonical lines are not clipped. */
  grepMaxLineBytes: number
  /** Maximum bytes in persisted search presentation metadata. */
  searchMetaMaxBytes: number
  /** Maximum complete ripgrep stdout bytes; overflow fails instead of clipping. */
  rawOutputMaxBytes: number
  /** Subprocess termination escalation grace in milliseconds. */
  graceMs: number
  /** Maximum bytes in the retained search stderr diagnostic tail. */
  stderrMaxBytes: number
  /** Normal search tool timeout in milliseconds; the operation deadline also applies. */
  timeoutMs: number
}

const fields = {
  approvedRoots: z.array(z.string()).min(1).required(),
  maxPathBytes: z.natural().min(1).required(),
  maxPatternBytes: z.natural().min(1).required(),
  readMaxLines: z.natural().min(1).required(),
  readMaxLineLength: z.natural().min(1).required(),
  readMaxBytes: z.natural().min(1).required(),
  readStreamMinSize: z.natural().min(1).required(),
  globMaxResults: z.natural().min(1).required(),
  sampleOverCapGlobResults: z.boolean().required(),
  grepMaxMatches: z.natural().min(1).required(),
  grepMaxLineBytes: z.natural().min(1).required(),
  searchMetaMaxBytes: z.natural().min(1).required(),
  rawOutputMaxBytes: z.natural().min(1).required(),
  graceMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).required(),
  stderrMaxBytes: z.natural().min(1).required(),
  timeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).required(),
}

export const Config: z<Config> = z.object(fields)

/**
 * Validate and freeze deployment configuration before registering tools.
 * @param config Loader or direct composition input.
 * @returns Immutable copied configuration, rejecting unsupported keys and unsafe bounds.
 */
export function resolveConfig(config: Config): Readonly<Config> {
  const keys = Object.keys(fields)
  for (const key of Object.keys(config)) {
    if (!keys.includes(key)) throw new Error(`operation-fs: unsupported configuration field ${JSON.stringify(key)}`)
  }
  const checked = Config(config)
  for (const [key, value] of Object.entries(checked)) {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      throw new Error(`operation-fs: ${key} must be a safe integer`)
    }
  }
  checked.approvedRoots = [...checked.approvedRoots]
  Object.freeze(checked.approvedRoots)
  return Object.freeze(checked)
}
