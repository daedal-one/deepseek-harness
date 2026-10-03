/**
 * Shared execution plumbing for the `glob` / `grep` search tools: the
 * package-owned `SEARCH_*` error vocabulary, one spawn helper that runs the
 * packaged ripgrep binary (`@vscode/ripgrep`) or a configured executable from
 * the subprocess execution world with a plain argv vector and returns complete
 * raw stdout, the best-effort formatted-result spill handoff,
 * and workdir-relative path display.
 *
 * Both tools execute as ordinary foreground spawns through `ctx.subprocess` —
 * never `ctx.shell`, never `ctx.shell.start()`, never a model-visible background
 * task. Local deployments use the binary shipped inside the npm package;
 * another execution world may supply a configured `rg`. No shell layer exists
 * between the argv vector and ripgrep, so no shell quoting is involved. Raw `rg` stdout is an internal
 * transport detail: the tools retain the raw stdout pipe within
 * `rawOutputMaxBytes`, drain excess bytes without retaining them, and decode
 * complete output as strict UTF-8 without stripping a filename's BOM. They
 * never read spill files. The model-facing recovery
 * artifact is the formatted result saved through `ctx.spillStore.saveText()`
 * ({@link trySaveFormattedResult}).
 *
 * @module @deepseek-ai/dsh-tool-fs-search/search-core
 */

import { existsSync } from 'node:fs'
import { isAbsolute, join, parse, relative, sep } from 'node:path'
import type { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { ItemRetainer, TextRetainer } from '@deepseek-ai/dsh-output-retention'
import type { RetainedItems } from '@deepseek-ai/dsh-output-retention'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { SaveTextSpill, SpillRef } from '@deepseek-ai/dsh-spill'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/**
 * Default cap on the complete raw `rg` stdout the tools will parse (the
 * `rawOutputMaxBytes` config), matching Claude Code's ripgrep raw buffer.
 */
export const RAW_OUTPUT_MAX_BYTES = 20_000_000

/**
 * Default cooperative tool-call timeout budget in milliseconds (the `timeoutMs`
 * config), attached to both tool definitions for
 * `@deepseek-ai/dsh-tool-call-timeout-policy` to enforce through `exec.signal`.
 */
export const SEARCH_TIMEOUT_MS = 30_000

/**
 * Default cap in bytes on the retained stderr tail of one search run — a
 * diagnostic excerpt only (the tool never reads a stderr spill path, and the
 * collect disposition requests none).
 */
export const SEARCH_STDERR_MAX_BYTES = 64 * 1024

/** Default terminate grace period for a search process (ms). */
export const SEARCH_GRACE_MS = 3_000

/**
 * Default cap in bytes on one search's serialized `presentationMeta` (the
 * `searchMetaMaxBytes` config). The inline match/path caps already bound the item
 * COUNT, but retained matches of a broad search (many long lines) can still
 * serialize to hundreds of kilobytes, and `meta` is persisted with the session
 * log and re-sent on every request. A deployment's final output budget
 * (`dsh-spill-policy`) only shrinks a result's `content`, never its `meta`, so the
 * projection owns this cap. 64 KiB holds the full default-capped result of a
 * typical search while bounding the pathological one.
 */
export const SEARCH_META_MAX_BYTES = 65_536

/**
 * Stable, machine-routable codes for search failures. Package-owned (not
 * `FsErrorCode`) because these tools are spawn-backed discovery, not `ctx.fs`
 * provider operations: `SEARCH_INVALID_PATTERN` — ripgrep rejected the regex or
 * glob; `SEARCH_FAILED` — the search could not run or its output could not be
 * parsed (a failed `rg` launch, inaccessible target, signal kill, malformed
 * `--json`); `SEARCH_RAW_OUTPUT_OVERFLOW` — raw `rg` output exceeded
 * `rawOutputMaxBytes` or stayed truncated after that requested stdout budget;
 * `SEARCH_ABORTED` — the cooperative tool timeout or caller cancellation cut
 * the search short.
 */
export type SearchErrorCode =
  | 'SEARCH_INVALID_PATTERN'
  | 'SEARCH_FAILED'
  | 'SEARCH_RAW_OUTPUT_OVERFLOW'
  | 'SEARCH_ABORTED'

/**
 * Typed search failure. Extends {@link HarnessError} so it carries a stable
 * {@link SearchErrorCode} and chains `cause`; the tool registry exposes
 * `{ name, code }` on `isError` results so retry/permission/UI layers can
 * branch without parsing messages.
 */
export class SearchError extends HarnessError {
  override readonly code: SearchErrorCode

  constructor(message: string, code: SearchErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}

/** The completed acquisition of one `rg` run: complete stdout plus the resolved workdir. */
export interface RipgrepRun {
  /** Complete raw stdout decoded as strict UTF-8, with a leading BOM preserved. */
  stdout: string
  /** True when ripgrep exited 1: a successful search with zero results. */
  noMatches: boolean
  /** The resolved working directory the command ran in (the display-relativization base). */
  workdir: string
}

/**
 * The retained stderr tail as a diagnostic excerpt, with a truncation note when
 * the subprocess seam dropped bytes.
 */
function stderrExcerpt(stderrText: string, truncated: boolean): string {
  const text = stderrText.trim()
  if (text.length === 0) return ''
  return truncated ? `${text} [stderr truncated]` : text
}

/**
 * Classify a nonzero-exit `rg` run into the search error vocabulary. There is
 * no shell layer, so an exit 127 or shell "command not found" text cannot
 * occur — a launch failure rejects at spawn (see {@link runRipgrep}).
 */
function classifyRunFailure(toolName: string, exitCode: number, stderrText: string, stderrTruncated: boolean): SearchError {
  const stderr = stderrExcerpt(stderrText, stderrTruncated)
  if (/regex parse error|error parsing glob/i.test(stderr)) {
    return new SearchError(`${toolName} pattern rejected by ripgrep: ${stderr}`, 'SEARCH_INVALID_PATTERN')
  }
  return new SearchError(`${toolName} search failed (exit ${exitCode})${stderr.length > 0 ? `: ${stderr}` : ''}`, 'SEARCH_FAILED')
}

interface RawStdout {
  readonly chunks: Buffer[]
  readonly overflow: boolean
}

/** Retain at most the raw-byte cap while draining the entire caller-owned pipe. */
async function collectStdout(toolName: string, stream: Readable | undefined, maxBytes: number): Promise<RawStdout> {
  if (stream === undefined) throw new SearchError(`${toolName} search command produced no raw stdout pipe`, 'SEARCH_FAILED')
  const chunks: Buffer[] = []
  let bytes = 0
  let overflow = false
  const retain = (chunk: unknown): void => {
    if (!(chunk instanceof Uint8Array)) {
      stream.destroy(new Error('ripgrep stdout pipe did not deliver raw bytes'))
      return
    }
    if (overflow) return
    if (chunk.byteLength > maxBytes - bytes) {
      overflow = true
      chunks.length = 0
      return
    }
    bytes += chunk.byteLength
    chunks.push(Buffer.from(chunk))
  }
  const closed = finished(stream, { cleanup: true })
  stream.on('data', retain)
  try {
    await closed
  } finally {
    stream.off('data', retain)
  }
  return { chunks, overflow }
}

/** Decode complete raw bytes without replacement characters or BOM removal. */
function completeStdout(toolName: string, stdout: RawStdout, rawOutputMaxBytes: number): string {
  if (stdout.overflow) {
    throw new SearchError(
      `${toolName} produced more raw output than the ${rawOutputMaxBytes}-byte cap; narrow pattern, path, or include and retry`,
      'SEARCH_RAW_OUTPUT_OVERFLOW',
    )
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(stdout.chunks))
  } catch (cause: unknown) {
    throw new SearchError(`${toolName} raw output is not valid UTF-8`, 'SEARCH_FAILED', { cause })
  }
}

let rgPathPromise: Promise<string> | undefined

/**
 * The packaged ripgrep binary path, resolved lazily once per process.
 *
 * A single-file runtime uses the executable's `-rg` sidecar because a native
 * helper cannot be spawned from pkg's virtual filesystem. Node-mode builds
 * fall back to the platform package selected by `@vscode/ripgrep`. Resolving
 * at the call boundary keeps a missing or corrupt binary at the first search
 * call as `SEARCH_FAILED`, rather than failing the Loader composition.
 *
 * @returns the packaged binary's absolute path; the memoized promise rejects
 *   when the platform package cannot be resolved.
 */
export function resolveRgPath(): Promise<string> {
  rgPathPromise ??= Promise.resolve().then(async () => {
    const executable = parse(process.execPath)
    const executableSidecar = process.platform === 'win32'
      ? join(executable.dir, `${executable.name}-rg.exe`)
      : `${process.execPath}-rg`
    if ('pkg' in process && existsSync(executableSidecar)) return executableSidecar
    return (await import('@vscode/ripgrep')).rgPath
  })
  return rgPathPromise
}

/**
 * Run the packaged ripgrep binary with a plain argv vector and return its
 * complete raw stdout. The working directory is the calling agent's session
 * cwd (`exec.agent.session.header.cwd`) when available, else
 * `process.cwd()`. `exec.signal` is forwarded so the cooperative tool timeout
 * (`@deepseek-ai/dsh-tool-call-timeout-policy`) and caller cancellation terminate the
 * process tree.
 *
 * The spawn is unconfined (a plain `ctx.subprocess` call), so `--no-config`
 * is prepended: a host `RIPGREP_CONFIG_PATH` (or `rg.conf` next to the
 * binary) can otherwise inject `--pre` and make ripgrep execute an arbitrary
 * preprocessor for every matched file. Stderr uses the seam's bounded
 * diagnostic tail; stdout uses its raw pipe. The caller drains and owns that
 * pipe, retaining at most `rawOutputMaxBytes`, and waits for managed-range
 * quiescence. Overflow fails as `SEARCH_RAW_OUTPUT_OVERFLOW`; invalid UTF-8
 * fails as `SEARCH_FAILED`. Errors and cancellation terminate the managed
 * range and close the pipe before awaiting their settlement.
 *
 * Exit semantics are tool-owned: exit 0 is success with results, exit 1 is
 * success with zero results (`noMatches`), anything else throws a
 * {@link SearchError} (abort/timeout → `SEARCH_ABORTED`, invalid pattern →
 * `SEARCH_INVALID_PATTERN`, the rest → `SEARCH_FAILED` /
 * `SEARCH_RAW_OUTPUT_OVERFLOW`). Both launch-time failure domains are
 * classified: a synchronous throw at spawn CREATION (a NUL in argv, an abort
 * racing the pre-check, a rejected `@vscode/ripgrep` resolution) reports that
 * the command could not start, while a rejection of `handle.done` reports a
 * provider failure without claiming whether execution began. Both become
 * `SEARCH_FAILED` with the original as `cause`; an abort already observed by
 * creation time becomes `SEARCH_ABORTED` instead.
 *
 * @param ctx - the plugin context; execution uses its `subprocess` service.
 * @param exec - the tool-execution context; supplies the session cwd and the abort signal.
 * @param toolName - `glob` or `grep`, used in error messages.
 * @param argv - the ripgrep arguments (every model value an unquoted argv element; no shell layer exists).
 * @param rawOutputMaxBytes - cap on the complete raw stdout the tool will parse.
 * @param graceMs - the seam's terminate-escalation grace period.
 * @param stderrMaxBytes - cap on the retained stderr diagnostic tail.
 * @param ripgrepCommand - optional executable resolved by the subprocess provider; omission uses the packaged host binary.
 * @returns the complete stdout, the zero-result flag, and the resolved workdir.
 */
export async function runRipgrep(
  ctx: Context,
  exec: ToolExecution,
  toolName: string,
  argv: readonly string[],
  rawOutputMaxBytes: number,
  graceMs: number,
  stderrMaxBytes: number,
  ripgrepCommand?: string,
): Promise<RipgrepRun> {
  if (exec.signal.aborted) {
    throw new SearchError(`${toolName} was aborted before completion (tool timeout or caller cancellation)`, 'SEARCH_ABORTED')
  }
  const cwd = exec.agent?.session.header.cwd
  let workdir = cwd ?? process.cwd()
  let handle: SubprocessHandle
  try {
    const executable = ripgrepCommand === undefined
      ? await resolveRgPath()
      : await ctx.subprocess.resolveExecutable(ripgrepCommand, undefined, exec.signal)
    workdir = ctx.subprocess.resolveWorkingDirectory(workdir)
    handle = ctx.subprocess.spawn({
      argv: [executable, '--no-config', ...argv],
      cwd: workdir,
      stdio: {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: { maxBytes: stderrMaxBytes },
      },
      graceMs,
      signal: exec.signal,
    } satisfies SubprocessSpawnSpec)
  } catch (error: unknown) {
    // Node's spawn() throws synchronously for a NUL in argv, and the local
    // impl can throw synchronously when the signal aborts between the check
    // above and this call (or when the platform-package resolution rejects).
    // The static narrowing that proves this re-check "always false" cannot
    // see AbortSignal state changes.
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (exec.signal.aborted) {
      throw new SearchError(`${toolName} was aborted before completion (tool timeout or caller cancellation)`, 'SEARCH_ABORTED')
    }
    throw new SearchError(`${toolName} could not start its search command (ripgrep launch failed)`, 'SEARCH_FAILED', { cause: error })
  }
  const done = handle.done.catch((cause: unknown) => {
    throw new SearchError(`${toolName} subprocess failed before reporting an outcome (ripgrep provider failure)`, 'SEARCH_FAILED', { cause })
  })
  const stdoutRead = collectStdout(toolName, handle.stdout, rawOutputMaxBytes)
  const rangeExited = Promise.resolve().then(() => handle.waitForExit())
  const cancel = (): void => {
    handle.terminate()
    handle.stdout?.destroy()
  }
  exec.signal.addEventListener('abort', cancel, { once: true })
  // Cancellation may have raced spawn and listener installation.
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  if (exec.signal.aborted) cancel()
  try {
    const [outcome, stdout] = await Promise.all([done, stdoutRead, rangeExited])
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (exec.signal.aborted) {
      throw new SearchError(`${toolName} was aborted before completion (tool timeout or caller cancellation)`, 'SEARCH_ABORTED')
    }
    const stderr = handle.collected.stderr?.readFrom(0)
    if (stderr === undefined) {
      throw new SearchError(`${toolName} search command produced no collected stderr stream`, 'SEARCH_FAILED')
    }
    if (outcome.signal !== null || outcome.exitCode === null) {
      throw new SearchError(`${toolName} search command was killed by signal ${outcome.signal ?? '(unknown)'}`, 'SEARCH_FAILED')
    }
    if (outcome.exitCode !== 0 && outcome.exitCode !== 1) {
      throw classifyRunFailure(toolName, outcome.exitCode, stderr.text, stderr.lossy)
    }
    const text = completeStdout(toolName, stdout, rawOutputMaxBytes)
    return { stdout: text, noMatches: outcome.exitCode === 1, workdir }
  } catch (cause: unknown) {
    cancel()
    const settled = await Promise.allSettled([done, stdoutRead, rangeExited])
    const range = settled[2]
    if (range.status === 'rejected') {
      throw new SearchError(`${toolName} could not observe its subprocess range exit`, 'SEARCH_FAILED', {
        cause: new AggregateError([cause, range.reason], 'ripgrep acquisition and cleanup failed'),
      })
    }
    if (cause instanceof SearchError) throw cause
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (exec.signal.aborted) {
      throw new SearchError(`${toolName} was aborted before completion (tool timeout or caller cancellation)`, 'SEARCH_ABORTED', { cause })
    }
    throw new SearchError(`${toolName} could not acquire complete raw stdout`, 'SEARCH_FAILED', { cause })
  } finally {
    exec.signal.removeEventListener('abort', cancel)
  }
}

/**
 * Map an `rg` output path to its display form: absolute paths inside the
 * resolved workdir become workdir-relative; everything else (relative output,
 * paths outside the workdir) passes through unchanged. Display-only —
 * returned paths are follow-up-readable in co-located workdir/filesystem
 * deployments where both resolve the same workspace (the documented v1
 * deployment requirement).
 *
 * @param path - one path as ripgrep printed it.
 * @param workdir - the resolved workdir the command ran in.
 * @returns the workdir-relative display path when possible, else `path` unchanged.
 */
export function toWorkdirRelative(path: string, workdir: string): string {
  if (!isAbsolute(path)) return path
  const rel = relative(workdir, path)
  if (rel.length === 0) return '.'
  if (rel === '..' || rel.startsWith(`..${sep}`)) return path
  return rel
}

/** One parsed match: the file, the 1-based line number, and the (possibly previewed) line text. */
export interface GrepMatch {
  path: string
  lineNumber: number
  line: string
}

/**
 * Bound one matched-line preview to `maxBytes` (UTF-8 boundary preserved) and
 * mark the cut. The cap is a per-line budget fact; the complete line stays in
 * the searched file for `read`.
 *
 * @param line - the matched line text (trailing newline already stripped).
 * @param maxBytes - the preview budget in bytes.
 * @returns the preview, suffixed with ` (line truncated)` when bytes were cut.
 */
export function previewLine(line: string, maxBytes: number): string {
  const retainer = new TextRetainer({ kind: 'head', maxBytes })
  retainer.push(line)
  const kept = retainer.finish()
  return kept.truncated ? `${kept.text} (line truncated)` : kept.text
}

/**
 * Apply the shared inline cap to a canonical `grep` match list: preview each
 * retained line to `maxLineBytes` and keep the first `maxMatches`. The single
 * retention pass both the model-facing render ({@link module:@deepseek-ai/dsh-tool-fs-search/grep}
 * `formatGrepOutput`) and the search-card projection
 * ({@link module:@deepseek-ai/dsh-tool-fs-search/presentation} `grepSearchMeta`)
 * consume, so text and card never disagree about which matches survived.
 *
 * @param matches - every match the search parsed (the canonical value's matches).
 * @param maxMatches - the inline match cap (the `grepMaxMatches` config).
 * @param maxLineBytes - the per-matched-line preview budget in bytes.
 * @returns the retention outcome over the previewed matches.
 */
export function retainGrepMatches(matches: GrepMatch[], maxMatches: number, maxLineBytes: number): RetainedItems<GrepMatch> {
  const retainer = new ItemRetainer<GrepMatch>({ kind: 'head', maxItems: maxMatches })
  for (const match of matches) retainer.push({ ...match, line: previewLine(match.line, maxLineBytes) })
  return retainer.finish()
}

/**
 * Apply the shared inline cap to a canonical `glob` path list: keep the first
 * `maxResults`. The single retention pass both the model-facing render and the
 * search-card projection consume.
 *
 * @param paths - every path the search discovered (the canonical value's paths).
 * @param maxResults - the inline path cap (the `globMaxResults` config).
 * @returns the retention outcome over the paths.
 */
export function retainGlobPaths(paths: string[], maxResults: number): RetainedItems<string> {
  const retainer = new ItemRetainer<string>({ kind: 'head', maxItems: maxResults })
  for (const path of paths) retainer.push(path)
  return retainer.finish()
}

/**
 * Best-effort save of one COMPLETE formatted search result through
 * `ctx.spillStore.saveText()` — the model-facing recovery path for a capped
 * result. `spillStore` is read with `ctx.get()` (not static inject) because
 * formatted-result spill is optional; the spill owner is the calling agent's
 * session header id and the source is the tool execution identity. A missing
 * backend, a call with no session owner, or a `saveText()` rejection logs a
 * warning and returns `undefined` — the caller keeps the inline result and
 * reports that the complete result could not be saved; search success never
 * turns into `isError` because spill storage is unavailable.
 *
 * @param ctx - the plugin context; `spillStore` is looked up opportunistically.
 * @param exec - the tool-execution context; supplies the owning session, tool name, and call id.
 * @param suggestedName - the backend-sanitized filename hint (e.g. `grep-results.txt`).
 * @param content - the complete formatted result to persist.
 * @returns the saved spill reference, or `undefined` when the result could not be saved.
 */
export async function trySaveFormattedResult(
  ctx: Context,
  exec: ToolExecution,
  suggestedName: string,
  content: string,
): Promise<SpillRef | undefined> {
  const sessionId = exec.agent?.session.header.id
  if (sessionId === undefined) {
    ctx.logger.warn(`tool-fs-search: no session owner for ${exec.name} result; complete result not saved`)
    return undefined
  }
  const spillStore = ctx.get('spillStore')
  if (!spillStore) {
    ctx.logger.warn(`tool-fs-search: no ctx.spillStore backend loaded; complete ${exec.name} result not saved`)
    return undefined
  }
  const save: SaveTextSpill = {
    owner: { sessionId },
    source: { kind: 'tool', toolName: exec.name, callId: exec.callId, label: 'result' },
    suggestedName,
    content,
  }
  try {
    return await spillStore.saveText(save)
  } catch (error: unknown) {
    // Best-effort: a storage failure must never fail the search or hide the
    // inline result — the footer reports the unsaved remainder instead.
    ctx.logger.warn(`tool-fs-search: saveText failed for ${exec.name}: ${String(error)}; complete result not saved`)
    return undefined
  }
}
