/** Isolated SDK trials; the controller owns acceptance, deadlines, and cleanup. */

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { performance } from 'node:perf_hooks'
import { createHash } from 'node:crypto'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import type { DeepSeekHarnessOptions, RunOptions, RunResult } from '@deepseek-ai/dsh-sdk-client'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { evaluateTask } from './acceptance.ts'
import type { AcceptanceResult } from './acceptance.ts'
import { taskById } from './tasks.ts'
import { DeliveryTrace } from './trace.ts'
import type { DeliveryCheck, DeliveryExperiment, DeliveryPhase, DeliveryTrial, DeliveryVariant } from './types.ts'

/** Test substitution stops at the SDK boundary; built smoke trials use the real client. */
export interface DeliveryHarness {
  start(): Promise<void>
  run(input: string, options: RunOptions): Promise<RunResult>
  close(): Promise<void>
}

/** The caller owns interruption; no private user home is ever reused. */
export interface TrialOptions {
  readonly repositoryRoot: string
  readonly artifactDirectory: string
  readonly experiment: DeliveryExperiment
  readonly variant: DeliveryVariant
  readonly task: string
  readonly repetition: number
  readonly signal: AbortSignal
  readonly patchHashes?: readonly string[]
  readonly createHarness?: (options: DeepSeekHarnessOptions) => DeliveryHarness
}

/** Allow only platform essentials and the explicitly selected live credential into the runtime. */
export function trialEnvironment(root: string, variant: DeliveryVariant, live: boolean): NodeJS.ProcessEnv {
  const home = join(root, 'home')
  const temp = join(root, 'tmp')
  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'], SystemRoot: process.env['SystemRoot'], WINDIR: process.env['WINDIR'],
    HOME: home, USERPROFILE: home, TMPDIR: temp, TMP: temp, TEMP: temp,
    XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'), XDG_DATA_HOME: join(home, 'data'),
    DSH_AGENTS_HOME: join(home, 'agents'), DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1',
  }
  if (live) {
    const name = variant.credentialEnv
    if (name === undefined || !process.env[name]) throw new Error('live variant requires its named credential environment variable')
    env[name] = process.env[name]
  }
  return env
}

/** Run one task through an idle candidate, external verification, and bounded same-session repairs. */
export async function runDeliveryTrial(options: TrialOptions): Promise<DeliveryTrial> {
  const { experiment, variant } = options
  const task = taskById(options.task)
  const trace = new DeliveryTrace()
  const checks: DeliveryCheck[] = []
  const phases: DeliveryPhase[] = []
  let finalizing = false
  let openPhase: Omit<DeliveryPhase, 'durationMs' | 'complete'> | undefined
  let retainedWorkspace: string | null = null
  let retainedVerifierRoot: string | null = null
  let root: string | undefined
  let harness: DeliveryHarness | undefined
  let closing: Promise<void> | undefined
  let closeStartedAt: number | undefined
  const close = (): Promise<void> => {
    if (harness === undefined) return Promise.resolve()
    if (closing === undefined) {
      closeStartedAt = performance.now()
      const ownedHarness = harness
      closing = Promise.resolve().then(() => ownedHarness.close())
    }
    return closing
  }
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let cancelled = options.signal.aborted
  let stoppedAt: number | undefined
  let started = performance.now()
  let bootMs = 0
  let deliveryStart: number | undefined
  let deliveryEnd: number | undefined
  let cleanupMs = 0
  let cleanupError: string | null = null
  let outcome: DeliveryTrial['outcome'] = 'error'
  let detail = 'trial did not start'
  let verificationPassed = false
  let repairRounds = 0
  let verification: Promise<AcceptanceResult> | undefined
  const interrupted = Promise.withResolvers<void>()
  const agentTurns: { round: number; reason: string }[] = []
  const stop = (): void => {
    stoppedAt ??= performance.now()
    controller.abort()
    interrupted.resolve()
    // The finally block awaits this exact close and preserves any cleanup error.
    void close().catch(() => undefined)
  }
  const cancel = (): void => { cancelled = true; stop() }
  options.signal.addEventListener('abort', cancel, { once: true })
  const scrub = (message: string): string => {
    let clean = root === undefined ? message : message.replaceAll(root, '<trial>')
    const secret = variant.credentialEnv === undefined ? undefined : process.env[variant.credentialEnv]
    if (secret) clean = clean.replaceAll(secret, '<credential>')
    return clean.slice(0, 2000)
  }
  try {
    if (cancelled) throw new Error('trial cancelled before startup')
    root = await mkdtemp(join(tmpdir(), 'dsh-coding-delivery-'))
    for (const directory of ['workspace', 'home', 'tmp']) await mkdir(join(root, directory))
    const cwd = join(root, 'workspace')
    for (const [file, text] of Object.entries(task.files)) {
      await mkdir(dirname(join(cwd, file)), { recursive: true })
      await writeFile(join(cwd, file), text, { flag: 'wx', mode: 0o600 })
    }
    const patch = join(root, 'benchmark.patch.yml')
    await writeFile(patch, profilePatch(root, options.artifactDirectory, task.id, variant, experiment.mode === 'scripted'), { mode: 0o600 })
    // Freeze explicitly supplied patches per trial; do not let live edits change a running composition.
    const patches = [patch]
    for (const [index, path] of variant.patches.entries()) {
      const copy = join(root, `variant-${index}.patch.yml`)
      const content = await readFile(path)
      if (createHash('sha256').update(content).digest('hex') !== options.patchHashes?.[index]) {
        throw new Error('variant patch changed or lacks the recorded experiment fingerprint')
      }
      await writeFile(copy, content, { flag: 'wx', mode: 0o600 })
      patches.push(copy)
    }
    const sdkOptions: DeepSeekHarnessOptions = {
      dshBin: join(options.repositoryRoot, 'apps', 'cli', 'lib', 'bin.js'),
      profile: 'sdk-minimal', dshHome: join(root, 'home'), processCwd: cwd, cwd, patches,
      provider: variant.provider, model: variant.model,
      ...variant.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(variant.reasoningEffort) },
      ...variant.maxTokens === undefined ? {} : { maxTokens: variant.maxTokens },
      env: trialEnvironment(root, variant, experiment.mode === 'live'),
      initializeTimeoutMs: 30_000, requestTimeoutMs: 15_000,
    }
    controller.signal.throwIfAborted()
    harness = options.createHarness?.(sdkOptions) ?? new DeepSeekHarness(sdkOptions)
    started = performance.now()
    const ownedHarness = harness
    const operation = (async (): Promise<void> => {
      openPhase = { name: 'boot', round: 0, startMs: 0 }
      try {
        await ownedHarness.start()
      } finally {
        if (!finalizing) {
          bootMs = performance.now() - started
          phases.push({ name: 'boot', round: 0, startMs: 0, durationMs: bootMs, complete: true })
          openPhase = undefined
        }
      }
      controller.signal.throwIfAborted()
      deliveryStart = performance.now()
      timer = setTimeout(() => { timedOut = true; stop() }, experiment.deadlineMs)
      let prompt = task.prompt
      for (let round = 0; round <= experiment.maxRepairs; round++) {
        controller.signal.throwIfAborted()
        repairRounds = round
        const agentStart = performance.now()
        let result: RunResult
        openPhase = { name: 'agent', round, startMs: agentStart - started }
        try {
          result = await ownedHarness.run(prompt, {
            sessionId: 'coding-delivery',
            onNotification: (notification) => { if (!finalizing) trace.observe(notification) },
          })
        } finally {
          if (!finalizing) {
            phases.push({ name: 'agent', round, startMs: agentStart - started, durationMs: performance.now() - agentStart, complete: true })
            openPhase = undefined
          }
        }
        controller.signal.throwIfAborted()
        const reason = result.events.findLast(event => event.type === 'turn/end')
        agentTurns.push({ round, reason: reason?.type === 'turn/end' ? reason.data.reason.kind : 'missing-turn-end' })
        const verifyStart = performance.now()
        openPhase = { name: 'verification', round, startMs: verifyStart - started }
        verification = evaluateTask(task, cwd, { signal: controller.signal, timeoutMs: Math.min(10_000, experiment.deadlineMs) })
        const check = await verification
        if (!finalizing) {
          phases.push({ name: 'verification', round, startMs: verifyStart - started, durationMs: performance.now() - verifyStart, complete: true })
          openPhase = undefined
        }
        checks.push({ ...check, detail: scrub(check.detail), round })
        controller.signal.throwIfAborted()
        if (check.failureKind === 'infrastructure') {
          outcome = 'error'
          detail = check.detail
          return
        }
        if (check.passed) {
          verificationPassed = true
          outcome = 'accepted'
          detail = 'independent acceptance passed'
          return
        }
        outcome = 'failed'
        detail = check.detail
        prompt = `Independent acceptance failed. Repair the implementation without changing the task requirements or protected files.\n${scrub(check.detail)}`
      }
    })()
    if (options.signal.aborted) cancel()
    await Promise.race([
      operation,
      interrupted.promise.then(() => { throw new Error('trial interrupted') }),
    ])
    deliveryEnd = performance.now()
  } catch (error: unknown) {
    deliveryEnd = stoppedAt ?? performance.now()
    outcome = timedOut ? 'timed-out' : 'error'
    detail = timedOut ? 'task delivery deadline exceeded' : cancelled ? 'trial cancelled' : error instanceof Error ? error.message : String(error)
  } finally {
    finalizing = true
    if (openPhase !== undefined) {
      const durationMs = Math.max(0, (stoppedAt ?? performance.now()) - started - openPhase.startMs)
      phases.push({ ...openPhase, durationMs, complete: false })
      if (openPhase.name === 'boot') bootMs = durationMs
      openPhase = undefined
    }
    if (timer !== undefined) clearTimeout(timer)
    controller.abort()
    options.signal.removeEventListener('abort', cancel)
    const cleanupStart = closeStartedAt ?? performance.now()
    let quiescent = true
    try {
      await close()
    } catch (error: unknown) {
      quiescent = false
      retainedWorkspace = root ?? null
      cleanupError = scrub(error instanceof Error ? error.message : String(error))
      if (verificationPassed) outcome = 'error'
    }
    // The verifier owns a different child; SDK shutdown cannot prove its exit.
    const finalCheck = await verification?.catch(() => undefined)
    if (finalCheck?.cleanupError) {
      const message = scrub(finalCheck.cleanupError)
      cleanupError = cleanupError === null ? message : `${cleanupError}; ${message}`
      retainedVerifierRoot = finalCheck.retainedVerifierRoot
      if (verificationPassed) outcome = 'error'
    }
    if (quiescent && root !== undefined) {
      try {
        await rm(root, { recursive: true, force: true })
      } catch (error: unknown) {
        retainedWorkspace = root
        const message = scrub(error instanceof Error ? error.message : String(error))
        cleanupError = cleanupError === null ? message : `${cleanupError}; ${message}`
        if (verificationPassed) outcome = 'error'
      }
    }
    cleanupMs = performance.now() - cleanupStart
    phases.push({ name: 'cleanup', round: repairRounds, startMs: cleanupStart - started, durationMs: cleanupMs, complete: true })
  }
  return {
    task: task.id, variant: variant.id, repetition: options.repetition, outcome, timedOut, cancelled,
    verificationPassed, detail: scrub(detail), cleanupError, retainedWorkspace, retainedVerifierRoot, bootMs,
    deliveryMs: deliveryStart === undefined ? null : Math.max(0, (deliveryEnd ?? performance.now()) - deliveryStart),
    cleanupMs, totalMs: performance.now() - started, repairRounds,
    checks: [...checks], agentTurns: [...agentTurns], phases: [...phases], trace: trace.snapshot(),
  }
}

function profilePatch(root: string, artifacts: string, task: string, variant: DeliveryVariant, scripted: boolean): string {
  return [
    '- id: session-log-deepseek', '  disabled: true',
    '- id: plugin-package-inventory-deepseek', '  disabled: true',
    '- id: sessions', '  config:', `    root: ${JSON.stringify(join(root, 'sessions'))}`, '    compression: none',
    ...scripted ? ['- id: llm-deepseek', '  disabled: true', '- id: llm-pi-ai', '  disabled: true'] : [],
    '- insert:',
    '    - id: fs-local', "      name: '@deepseek-ai/dsh-fs-local'",
    '    - id: str-replace-editor', "      name: '@deepseek-ai/dsh-tool-str-replace-editor'",
    ...scripted ? [
      '    - id: coding-benchmark-model', `      name: ${JSON.stringify(join(artifacts, 'scripted-adapter.js'))}`,
      '      config:', `        task: ${JSON.stringify(task)}`, `        behavior: ${JSON.stringify(variant.scriptedBehavior)}`,
    ] : [],
    '',
  ].join('\n')
}
