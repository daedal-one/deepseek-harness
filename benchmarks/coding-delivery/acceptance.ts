/** Isolated acceptance for fixed coding-delivery task artifacts. */

import { spawn, type ChildProcess } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { pathToFileURL } from 'node:url'
import type { CodingTask, EvaluationCase, JsonValue } from './tasks.ts'

const MAX_CANDIDATE_FILE_BYTES = 1_048_576
const MAX_CHILD_OUTPUT_BYTES = 16_384
const MAX_DIAGNOSTIC_CHARS = 1_200
const VERIFIER_EXIT_CONFIRMATION_MS = 1_000
const VERIFIER_PROTOCOL = '__dsh_coding_delivery_result_v1__'

const CHILD_PROGRAM = `
const protocol = ${JSON.stringify(VERIFIER_PROTOCOL)}
const [entryUrl, caseName, exportName, encodedArgs] = process.argv.slice(1)

function describeError(error) {
  if (error instanceof Error) return { name: error.name, message: error.message }
  return { name: 'Error', message: String(error) }
}

function emit(result) {
  process.stdout.write(protocol + JSON.stringify(result) + '\\n')
}

async function evaluate() {
  const args = JSON.parse(encodedArgs)
  const namespace = await import(entryUrl)
  const candidate = namespace[exportName]
  if (typeof candidate !== 'function') {
    throw new TypeError('export ' + exportName + ' is not a function')
  }
  let value
  try {
    value = await candidate(...args)
  } catch (error) {
    return { status: 'rejected', error: describeError(error) }
  }
  const encodedValue = JSON.stringify(value)
  if (encodedValue === undefined) {
    throw new TypeError('export ' + exportName + ' did not return a JSON value')
  }
  return { status: 'fulfilled', value: JSON.parse(encodedValue) }
}

try {
  emit({ protocol, caseName, exportName, ...await evaluate() })
} catch (error) {
  emit({ protocol, caseName, exportName, status: 'invalid', error: describeError(error) })
}
`

class CandidateFailure extends Error {}

class InfrastructureFailure extends Error {}

interface ChildRun {
  readonly stdout: Buffer
  readonly stderr: Buffer
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly aborted: boolean
  readonly outputLimitExceeded: boolean
  readonly spawnError: Error | undefined
  readonly cleanupError: string | null
}

interface FulfilledVerifierResult {
  readonly status: 'fulfilled'
  readonly value: JsonValue
}

/** Exceptions from invoking the candidate export, excluding verifier setup and serialization. */
interface RejectedVerifierResult {
  readonly status: 'rejected'
  readonly error: {
    readonly name: string
    readonly message: string
  }
}

type VerifierResult = FulfilledVerifierResult | RejectedVerifierResult

/** The independently observed acceptance outcome for one coding task workspace. */
export interface AcceptanceResult {
  readonly passed: boolean
  /** Null on success; failure classification is independent of process exit observations. */
  readonly failureKind: 'candidate' | 'infrastructure' | 'aborted' | 'timeout' | null
  readonly detail: string
  readonly checks: number
  readonly timedOut: boolean
  readonly exitCode: number | null
  readonly signal: string | null
  /** Null when verifier process quiescence and directory removal are confirmed. */
  readonly cleanupError: string | null
  /** Directory preserved after cleanup failure; the caller must not assume its child has exited. */
  readonly retainedVerifierRoot: string | null
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isSafeTaskPath(path: string): boolean {
  if (path.length === 0 || path.includes('\\') || path.includes('\0') || path.startsWith('/')) return false
  const parts = path.split('/')
  return parts.length <= 2 && parts.every(part => part !== '' && part !== '.' && part !== '..')
}

function boundedDiagnostic(value: string, verifierRoot: string): string {
  const redacted = verifierRoot === '' ? value : value.replaceAll(verifierRoot, '<verifier-root>')
  const normalized = redacted.replace(/\s+/g, ' ').trim()
  if (normalized.length <= MAX_DIAGNOSTIC_CHARS) return normalized
  return `${normalized.slice(0, MAX_DIAGNOSTIC_CHARS)}…`
}

function diagnosticSuffix(stderr: Buffer, verifierRoot: string): string {
  const detail = boundedDiagnostic(stderr.toString('utf8'), verifierRoot)
  return detail === '' ? '' : `; stderr: ${detail}`
}

function describeJson(value: JsonValue): string {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) return '<non-JSON value>'
  return encoded.length <= 400 ? encoded : `${encoded.slice(0, 400)}…`
}

function assertTask(task: CodingTask): void {
  const filePaths = Object.keys(task.files)
  const editablePaths = Object.keys(task.solution)
  if (filePaths.length === 0) throw new InfrastructureFailure('coding task has no initial files')
  if (editablePaths.length === 0) throw new InfrastructureFailure('coding task has no editable files')
  for (const path of filePaths) {
    if (!isSafeTaskPath(path)) throw new InfrastructureFailure(`coding task has an unsafe file path: ${path}`)
    if (typeof task.files[path] !== 'string') throw new InfrastructureFailure(`coding task file ${path} is not text`)
  }
  if (!hasOwn(task.files, 'package.json') || !hasOwn(task.files, 'README.md')) {
    throw new InfrastructureFailure('coding task must include protected package.json and README.md')
  }
  for (const path of editablePaths) {
    if (!isSafeTaskPath(path)) throw new InfrastructureFailure(`coding task has an unsafe editable path: ${path}`)
    if (!hasOwn(task.files, path)) throw new InfrastructureFailure(`editable file ${path} is absent from initial files`)
    if (path === 'package.json' || path === 'README.md') {
      throw new InfrastructureFailure(`protected file ${path} cannot be editable`)
    }
  }
  if (!editablePaths.includes(task.entrypoint)) {
    throw new InfrastructureFailure('coding task entrypoint must be editable')
  }
  if (task.cases.length === 0) throw new InfrastructureFailure('coding task has no evaluation cases')
  for (const evaluation of task.cases) {
    if (evaluation.name === '' || evaluation.exportName === '') {
      throw new InfrastructureFailure('coding task case is missing a name or export')
    }
    try {
      if (JSON.stringify(evaluation.args) === undefined || JSON.stringify(evaluation.expected) === undefined) {
        throw new InfrastructureFailure(`coding task case ${evaluation.name} is not JSON serializable`)
      }
    } catch (error) {
      if (error instanceof InfrastructureFailure) throw error
      throw new InfrastructureFailure(`coding task case ${evaluation.name} is not JSON serializable`)
    }
  }
}

async function candidateStats(path: string, label: string) {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CandidateFailure(`${label} is missing`)
    }
    throw error
  }
}

async function inspectCandidateFile(workspace: string, path: string): Promise<string> {
  const workspaceStats = await candidateStats(workspace, 'workspace root')
  if (workspaceStats.isSymbolicLink()) throw new CandidateFailure('workspace root is a symbolic link')
  if (!workspaceStats.isDirectory()) throw new CandidateFailure('workspace root is not a directory')

  const parts = path.split('/')
  let current = workspace
  for (const [index, part] of parts.entries()) {
    current = join(current, part)
    const stats = await candidateStats(current, index === parts.length - 1 ? `task file ${path}` : `task path ancestor ${part}`)
    if (stats.isSymbolicLink()) throw new CandidateFailure(`${index === parts.length - 1 ? `task file ${path}` : `task path ancestor ${part}`} is a symbolic link`)
    if (index !== parts.length - 1 && !stats.isDirectory()) {
      throw new CandidateFailure(`task path ancestor ${part} is not a directory`)
    }
    if (index === parts.length - 1) {
      if (!stats.isFile()) throw new CandidateFailure(`task file ${path} is not a regular file`)
      if (stats.size > MAX_CANDIDATE_FILE_BYTES) {
        throw new CandidateFailure(`task file ${path} exceeds ${String(MAX_CANDIDATE_FILE_BYTES)} bytes`)
      }
    }
  }
  return current
}

async function readCandidateFile(workspace: string, path: string): Promise<Buffer> {
  const candidatePath = await inspectCandidateFile(workspace, path)
  let content: Buffer
  try {
    content = await readFile(candidatePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CandidateFailure(`task file ${path} is missing`)
    }
    throw error
  }
  if (Buffer.byteLength(content) > MAX_CANDIDATE_FILE_BYTES) {
    throw new CandidateFailure(`task file ${path} exceeds ${String(MAX_CANDIDATE_FILE_BYTES)} bytes`)
  }
  await inspectCandidateFile(workspace, path)
  return content
}

function permissionArguments(verifierRoot: string): string[] {
  const flags = process.allowedNodeEnvironmentFlags
  if (!flags.has('--permission') || !flags.has('--allow-fs-read')) {
    throw new InfrastructureFailure('verifier requires Node.js with --permission and --allow-fs-read support')
  }
  return ['--permission', `--allow-fs-read=${verifierRoot}`]
}

function appendBounded(current: Buffer, next: Buffer): Buffer {
  const remaining = MAX_CHILD_OUTPUT_BYTES - current.byteLength
  if (remaining <= 0) return current
  return Buffer.concat([current, next.subarray(0, remaining)])
}

function runVerifierCase(
  verifierRoot: string,
  entrypoint: string,
  evaluation: EvaluationCase,
  signal: AbortSignal,
): Promise<ChildRun> {
  const encodedArgs = JSON.stringify(evaluation.args)
  if (encodedArgs === undefined) return Promise.reject(new InfrastructureFailure(`case ${evaluation.name} has invalid JSON arguments`))
  if (signal.aborted) {
    return Promise.resolve({
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      exitCode: null,
      signal: null,
      aborted: true,
      outputLimitExceeded: false,
      spawnError: undefined,
      cleanupError: null,
    })
  }

  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(process.execPath, [
        ...permissionArguments(verifierRoot),
        '--input-type=module',
        '--eval',
        CHILD_PROGRAM,
        pathToFileURL(join(verifierRoot, entrypoint)).href,
        evaluation.name,
        evaluation.exportName,
        encodedArgs,
      ], {
        cwd: verifierRoot,
        env: {},
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      reject(error)
      return
    }

    let stdout: Buffer = Buffer.alloc(0)
    let stderr: Buffer = Buffer.alloc(0)
    let aborted = false
    let outputLimitExceeded = false
    let spawnError: Error | undefined
    let settled = false
    let exitConfirmation: ReturnType<typeof setTimeout> | undefined
    let terminationFailure: string | undefined

    const terminate = () => {
      if (settled || exitConfirmation !== undefined) return
      exitConfirmation = setTimeout(() => {
        const reason = terminationFailure === undefined ? '' : `; ${terminationFailure}`
        finish(child.exitCode, child.signalCode,
          `verifier process ${String(child.pid)} exit/stdio closure was not confirmed within ${String(VERIFIER_EXIT_CONFIRMATION_MS)} ms of termination${reason}`)
      }, VERIFIER_EXIT_CONFIRMATION_MS)
      try {
        if (!child.killed && !child.kill('SIGKILL')) terminationFailure = 'SIGKILL returned false'
      } catch (error) {
        terminationFailure = `SIGKILL failed: ${boundedDiagnostic(error instanceof Error ? error.message : String(error), verifierRoot)}`
      }
    }
    const abortChild = () => {
      aborted = true
      terminate()
    }
    const finish = (exitCode: number | null, childSignal: NodeJS.Signals | null, cleanupError: string | null = null) => {
      if (settled) return
      settled = true
      clearTimeout(exitConfirmation)
      signal.removeEventListener('abort', abortChild)
      child.removeListener('error', childError)
      child.removeListener('close', finish)
      child.stdout?.removeListener('data', collectStdout)
      child.stderr?.removeListener('data', collectStderr)
      child.stdout?.destroy()
      child.stderr?.destroy()
      if (cleanupError !== null) child.unref()
      resolve({ stdout, stderr, exitCode, signal: childSignal, aborted, outputLimitExceeded, spawnError, cleanupError })
    }
    const collectStdout = (chunk: Buffer) => {
      if (stdout.byteLength + chunk.byteLength > MAX_CHILD_OUTPUT_BYTES) {
        outputLimitExceeded = true
        terminate()
      }
      stdout = appendBounded(stdout, chunk)
    }
    const collectStderr = (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk)
    }

    const childError = (error: Error) => {
      spawnError = error
      if (child.pid === undefined) finish(null, null)
      else terminate()
    }

    child.stdout?.on('data', collectStdout)
    child.stderr?.on('data', collectStderr)
    child.on('error', childError)
    child.once('close', finish)
    signal.addEventListener('abort', abortChild, { once: true })
    if (signal.aborted) abortChild()
  })
}

function parseVerifierResult(
  stdout: Buffer,
  evaluation: EvaluationCase,
): VerifierResult {
  const records = stdout.toString('utf8').split('\n').filter(line => line.startsWith(VERIFIER_PROTOCOL))
  if (records.length !== 1) {
    throw new CandidateFailure(`case ${evaluation.name} did not emit exactly one complete verifier result`)
  }
  const encoded = records[0]?.slice(VERIFIER_PROTOCOL.length)
  let parsed: unknown
  try {
    parsed = JSON.parse(encoded ?? '')
  } catch {
    throw new CandidateFailure(`case ${evaluation.name} emitted malformed verifier JSON`)
  }
  if (!isRecord(parsed)
    || parsed['protocol'] !== VERIFIER_PROTOCOL
    || parsed['caseName'] !== evaluation.name
    || parsed['exportName'] !== evaluation.exportName
    || typeof parsed['status'] !== 'string') {
    throw new CandidateFailure(`case ${evaluation.name} emitted an incomplete verifier result`)
  }
  if (parsed['status'] === 'fulfilled') {
    if (!hasOwn(parsed, 'value')) {
      throw new CandidateFailure(`case ${evaluation.name} omitted its returned value`)
    }
    return { status: 'fulfilled', value: parsed['value'] as JsonValue }
  }
  if ((parsed['status'] === 'rejected' || parsed['status'] === 'invalid') && isRecord(parsed['error'])
    && typeof parsed['error']['name'] === 'string' && typeof parsed['error']['message'] === 'string') {
    if (parsed['status'] === 'invalid') {
      throw new CandidateFailure(`case ${evaluation.name} verifier failure: ${parsed['error']['name']}: ${parsed['error']['message']}`)
    }
    return {
      status: 'rejected',
      error: { name: parsed['error']['name'], message: parsed['error']['message'] },
    }
  }
  throw new CandidateFailure(`case ${evaluation.name} emitted an incomplete verifier result`)
}

function stoppedResult(
  timedOut: boolean,
  timeoutMs: number,
  checks: number,
  exitCode: number | null,
  signal: string | null,
): AcceptanceResult {
  return {
    passed: false,
    failureKind: timedOut ? 'timeout' : 'aborted',
    detail: timedOut ? `verification timed out after ${String(timeoutMs)} ms` : 'verification aborted',
    checks,
    timedOut,
    exitCode,
    signal,
    cleanupError: null,
    retainedVerifierRoot: null,
  }
}

async function verifyTask(
  task: CodingTask,
  workspace: string,
  verifierRoot: string,
  signal: AbortSignal,
  timedOut: () => boolean,
  timeoutMs: number,
): Promise<AcceptanceResult> {
  let checks = 0
  let exitCode: number | null = null
  let childSignal: string | null = null
  const editablePaths = Object.keys(task.solution)
  const editable = new Set(editablePaths)
  try {
    for (const [path, initial] of Object.entries(task.files)) {
      if (signal.aborted) return stoppedResult(timedOut(), timeoutMs, checks, exitCode, childSignal)
      if (editable.has(path)) continue
      const actual = await readCandidateFile(workspace, path)
      if (!actual.equals(Buffer.from(initial))) {
        throw new CandidateFailure(`protected file ${path} changed`)
      }
    }

    for (const path of editablePaths) {
      if (signal.aborted) return stoppedResult(timedOut(), timeoutMs, checks, exitCode, childSignal)
      const source = await readCandidateFile(workspace, path)
      const destination = join(verifierRoot, path)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, source, { mode: 0o600 })
    }

    for (const evaluation of task.cases) {
      if (signal.aborted) return stoppedResult(timedOut(), timeoutMs, checks, exitCode, childSignal)
      const run = await runVerifierCase(verifierRoot, task.entrypoint, evaluation, signal)
      checks += 1
      exitCode = run.exitCode
      childSignal = run.signal
      if (run.cleanupError !== null) {
        return {
          passed: false,
          failureKind: 'infrastructure',
          detail: `infrastructure failure: ${run.cleanupError}`,
          checks,
          timedOut: timedOut(),
          exitCode,
          signal: childSignal,
          cleanupError: run.cleanupError,
          retainedVerifierRoot: verifierRoot,
        }
      }
      if (signal.aborted || run.aborted) {
        return stoppedResult(timedOut(), timeoutMs, checks, exitCode, childSignal)
      }
      if (run.spawnError !== undefined) {
        throw new InfrastructureFailure(`unable to start verifier: ${boundedDiagnostic(run.spawnError.message, verifierRoot)}`)
      }
      if (run.outputLimitExceeded) {
        throw new CandidateFailure(`case ${evaluation.name} exceeded the verifier output limit`)
      }
      if (run.exitCode !== 0 || run.signal !== null) {
        throw new CandidateFailure(
          `case ${evaluation.name} exited with code ${String(run.exitCode)} and signal ${String(run.signal)}`
          + diagnosticSuffix(run.stderr, verifierRoot),
        )
      }
      const result = parseVerifierResult(run.stdout, evaluation)
      if (evaluation.expectError !== undefined) {
        if (result.status !== 'rejected') {
          throw new CandidateFailure(`case ${evaluation.name} returned successfully instead of rejecting`)
        }
        if (result.error.name !== evaluation.expectError) {
          throw new CandidateFailure(`case ${evaluation.name} rejected with ${boundedDiagnostic(result.error.name, verifierRoot)} instead of ${evaluation.expectError}`)
        }
        continue
      }
      if (result.status === 'rejected') {
        throw new CandidateFailure(`case ${evaluation.name} rejected: ${boundedDiagnostic(result.error.message, verifierRoot)}`)
      }
      if (!isDeepStrictEqual(result.value, evaluation.expected)) {
        throw new CandidateFailure(
          `case ${evaluation.name} returned ${describeJson(result.value)} instead of ${describeJson(evaluation.expected)}`,
        )
      }
    }
    return {
      passed: true,
      failureKind: null,
      detail: `accepted ${String(checks)} checks`,
      checks,
      timedOut: false,
      exitCode,
      signal: childSignal,
      cleanupError: null,
      retainedVerifierRoot: null,
    }
  } catch (error) {
    if (signal.aborted) return stoppedResult(timedOut(), timeoutMs, checks, exitCode, childSignal)
    const candidateFailure = error instanceof CandidateFailure
    const prefix = candidateFailure ? 'candidate rejection' : 'infrastructure failure'
    return {
      passed: false,
      failureKind: candidateFailure ? 'candidate' : 'infrastructure',
      detail: `${prefix}: ${boundedDiagnostic(error instanceof Error ? error.message : String(error), verifierRoot)}`,
      checks,
      timedOut: false,
      exitCode,
      signal: childSignal,
      cleanupError: null,
      retainedVerifierRoot: null,
    }
  }
}

/**
 * Evaluate one candidate workspace without exposing controller-owned cases to it.
 * @param task - fixed task definition and allowed deliverables.
 * @param workspace - editable candidate workspace.
 * @param options - direct cancellation signal and full-task deadline, followed by at most 1000 ms for child exit confirmation.
 * @returns classified acceptance and observed child exit facts; cleanup failure reports a retained verifier directory that may still have a running child.
 */
export async function evaluateTask(
  task: CodingTask,
  workspace: string,
  options: { signal: AbortSignal; timeoutMs: number },
): Promise<AcceptanceResult> {
  if (options.signal.aborted) {
    return stoppedResult(false, options.timeoutMs, 0, null, null)
  }
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    return {
      passed: false,
      failureKind: 'infrastructure',
      detail: 'infrastructure failure: timeoutMs must be a positive safe integer',
      checks: 0,
      timedOut: false,
      exitCode: null,
      signal: null,
      cleanupError: null,
      retainedVerifierRoot: null,
    }
  }

  const deadline = new AbortController()
  let locallyTimedOut = false
  const timeout = setTimeout(() => {
    locallyTimedOut = true
    deadline.abort()
  }, options.timeoutMs)
  const signal = AbortSignal.any([options.signal, deadline.signal])
  let verifierRoot: string | undefined
  let result: AcceptanceResult
  let cleanupFailure: unknown
  let retainVerifierRoot = false

  try {
    assertTask(task)
    if (signal.aborted) return stoppedResult(locallyTimedOut, options.timeoutMs, 0, null, null)
    verifierRoot = await mkdtemp(join(tmpdir(), 'dsh-coding-delivery-verifier-'))
    await chmod(verifierRoot, 0o700)
    result = await verifyTask(task, workspace, verifierRoot, signal, () => locallyTimedOut, options.timeoutMs)
    retainVerifierRoot = result.retainedVerifierRoot !== null
    if (signal.aborted && result.cleanupError === null) {
      result = stoppedResult(locallyTimedOut, options.timeoutMs, result.checks, result.exitCode, result.signal)
    }
  } catch (error) {
    result = {
      passed: false,
      failureKind: 'infrastructure',
      detail: `infrastructure failure: ${boundedDiagnostic(error instanceof Error ? error.message : String(error), verifierRoot ?? '')}`,
      checks: 0,
      timedOut: false,
      exitCode: null,
      signal: null,
      cleanupError: null,
      retainedVerifierRoot: null,
    }
  } finally {
    clearTimeout(timeout)
    if (verifierRoot !== undefined && !retainVerifierRoot) {
      try {
        await rm(verifierRoot, { recursive: true, force: true })
      } catch (error) {
        cleanupFailure = error
      }
    }
  }

  if (cleanupFailure !== undefined) {
    const cleanupError = `verifier cleanup failed: ${boundedDiagnostic(cleanupFailure instanceof Error ? cleanupFailure.message : String(cleanupFailure), verifierRoot ?? '')}`
    return {
      passed: false,
      failureKind: 'infrastructure',
      detail: `infrastructure failure: ${cleanupError}`,
      checks: result.checks,
      timedOut: result.timedOut,
      exitCode: result.exitCode,
      signal: result.signal,
      cleanupError,
      retainedVerifierRoot: verifierRoot ?? null,
    }
  }
  return result
}
