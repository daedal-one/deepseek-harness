/** Controller tests own private worlds and never invoke a provider. */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { RunResult } from '@deepseek-ai/dsh-sdk-client'
import { parseExperiment, trialSchedule } from '../benchmarks/coding-delivery/config.ts'
import { runDeliveryTrial, trialEnvironment } from '../benchmarks/coding-delivery/runner.ts'
import { CODING_TASKS } from '../benchmarks/coding-delivery/tasks.ts'
import { DeliveryTrace } from '../benchmarks/coding-delivery/trace.ts'
import * as acceptance from '../benchmarks/coding-delivery/acceptance.ts'
import { comparePairs, renderSummary, summarizeTrials } from '../benchmarks/coding-delivery/report.ts'
import { main } from './benchmark-coding-delivery.ts'
import type { DeliveryTrial } from '../benchmarks/coding-delivery/types.ts'

function completed(reason: 'completed' | 'max-tokens' = 'completed'): RunResult {
  return { sessionId: 'coding-delivery', finalResponse: 'done', notifications: [], events: [
    { type: 'turn/end', seq: SessionSeq(0), time: 1, data: { turn: 1, reason: { kind: reason } } },
  ] }
}

function sample(variant: string, outcome: DeliveryTrial['outcome'], deliveryMs: number): DeliveryTrial {
  return {
    task: 'fixture', variant, repetition: 0, outcome, deliveryMs,
    timedOut: outcome === 'timed-out', cancelled: false, verificationPassed: outcome === 'accepted',
    detail: '', cleanupError: null, retainedWorkspace: null, retainedVerifierRoot: null,
    bootMs: 1, cleanupMs: 1, totalMs: deliveryMs + 2,
    repairRounds: 0, checks: [], agentTurns: [], phases: [], trace: new DeliveryTrace().snapshot(),
  }
}

describe('coding experiment configuration', () => {
  it('refuses live execution without the explicit unrestricted-code acknowledgement', async () => {
    await expect(main(['--live'])).rejects.toThrow('--allow-unconfined')
    await expect(main(['--allow-unconfined'])).rejects.toThrow('only with --live')
  })

  it('defaults to keyless controls and rejects implicit providers and unknown fields', () => {
    expect(parseExperiment({}, 'scripted', '/config').variants[0]?.provider).toBe('coding-bench')
    for (const input of [
      { variants: [{ id: 'x', provider: 'openrouter' }] },
      { variants: [{ id: 'x', patches: ['provider.yml'] }] },
      { variants: [{ id: 'x', apiKey: 'not-a-real-secret' }] },
      { repetitions: 0 }, { deadlineMs: -1 }, { tasks: ['missing'] },
      { variants: [{ id: 'x' }, { id: 'x' }] },
    ]) expect(() => parseExperiment(input, 'scripted', '/config')).toThrow()
    expect(() => parseExperiment({}, 'live', '/config')).toThrow('explicit configurations')
  })

  it('requires named live credentials and reproduces paired scheduling', () => {
    const live = parseExperiment({ variants: [{ id: 'live', provider: 'openrouter', model: 'test', credentialEnv: 'OPENROUTER_API_KEY' }] }, 'live', '/config')
    expect(live.variants[0]?.credentialEnv).toBe('OPENROUTER_API_KEY')
    const experiment = parseExperiment({ repetitions: 3, seed: 42, variants: [{ id: 'a' }, { id: 'b' }] }, 'scripted', '/config')
    expect(trialSchedule(experiment)).toEqual(trialSchedule(experiment))
    expect(trialSchedule(experiment)).toHaveLength(CODING_TASKS.length * 6)
    const env = trialEnvironment('/owned', experiment.variants[0]!, false)
    expect(env['HOME']).toBe(join('/owned', 'home'))
    expect(env).not.toHaveProperty('NODE_OPTIONS')
    expect(env).not.toHaveProperty('OPENROUTER_API_KEY')
    expect(env).not.toHaveProperty('DSH_SESSION_ID')
  })
})

describe('independently verified delivery controller', () => {
  it.each(['completed', 'max-tokens'] as const)('verifies artifacts and repair independently of idle reason %s', async (reason) => {
    const task = CODING_TASKS[0]!
    const experiment = parseExperiment({ tasks: [task.id] }, 'scripted', process.cwd())
    let workspace = ''
    let runs = 0
    let closes = 0
    const report = await runDeliveryTrial({
      repositoryRoot: process.cwd(), artifactDirectory: process.cwd(), experiment,
      variant: experiment.variants[0]!, task: task.id, repetition: 0, signal: new AbortController().signal,
      createHarness: (options) => {
        workspace = options.cwd!
        return {
          start: () => Promise.resolve(),
          run: async (_input, options) => {
            expect(options.sessionId).toBe('coding-delivery')
            if (runs++ > 0) {
              for (const [path, content] of Object.entries(task.solution)) {
                await mkdir(dirname(join(workspace, path)), { recursive: true })
                await writeFile(join(workspace, path), content)
              }
            }
            return completed(reason)
          },
          close: () => { closes++; return Promise.resolve() },
        }
      },
    })
    expect(report.outcome).toBe('accepted')
    expect(report.checks.map(check => check.passed)).toEqual([false, true])
    expect(report.repairRounds).toBe(1)
    expect(report.agentTurns).toEqual([{ round: 0, reason }, { round: 1, reason }])
    expect(report.deliveryMs).toBeGreaterThanOrEqual(report.phases.filter(phase => phase.name === 'verification').reduce((sum, phase) => sum + phase.durationMs, 0))
    expect(closes).toBe(1)
    await expect(readFile(join(workspace, 'package.json'))).rejects.toThrow()
  })

  it('records deadline expiration independently of the SDK transport error and awaits close', async () => {
    const task = CODING_TASKS[0]!
    const experiment = parseExperiment({ tasks: [task.id], deadlineMs: 100 }, 'scripted', process.cwd())
    let rejectRun: ((error: Error) => void) | undefined
    let closed = false
    const report = await runDeliveryTrial({
      repositoryRoot: process.cwd(), artifactDirectory: process.cwd(), experiment,
      variant: experiment.variants[0]!, task: task.id, repetition: 0, signal: new AbortController().signal,
      createHarness: () => ({
        start: () => Promise.resolve(),
        run: () => new Promise((_resolve, reject) => { rejectRun = reject }),
        close: () => { closed = true; rejectRun?.(new Error('transport closed')); return Promise.resolve() },
      }),
    })
    expect(report.outcome).toBe('timed-out')
    expect(report.timedOut).toBe(true)
    expect(report.verificationPassed).toBe(false)
    expect(report.deliveryMs).not.toBeNull()
    expect(closed).toBe(true)
  })

  it('settles a deadline despite failed close and ignores SDK settlement after reporting', async () => {
    const activity = Promise.withResolvers<RunResult>()
    const task = CODING_TASKS[0]!
    const experiment = parseExperiment({ tasks: [task.id], deadlineMs: 100 }, 'scripted', process.cwd())
    let workspace = ''
    try {
      const report = await runDeliveryTrial({
        repositoryRoot: process.cwd(), artifactDirectory: process.cwd(), experiment,
        variant: experiment.variants[0]!, task: task.id, repetition: 0, signal: new AbortController().signal,
        createHarness: (options) => {
          workspace = options.cwd!
          return {
            start: () => Promise.resolve(),
            run: () => activity.promise,
            close: () => Promise.reject(new Error('shutdown failed')),
          }
        },
      })
      expect(report.outcome).toBe('timed-out')
      expect(report.cleanupError).toBe('shutdown failed')
      expect(report.retainedWorkspace).toBe(dirname(workspace))
      expect(report.deliveryMs).not.toBeNull()
      expect(report.phases.find(phase => phase.name === 'agent')).toMatchObject({ complete: false })
      const recorded = JSON.stringify(report)
      activity.resolve(completed())
      await new Promise(resolve => setImmediate(resolve))
      expect(JSON.stringify(report)).toBe(recorded)
    } finally {
      if (workspace !== '') await rm(dirname(workspace), { recursive: true, force: true })
    }
  })

  it('does not launch an already-cancelled trial', async () => {
    const experiment = parseExperiment({}, 'scripted', process.cwd())
    let created = false
    const report = await runDeliveryTrial({
      repositoryRoot: process.cwd(), artifactDirectory: process.cwd(), experiment,
      variant: experiment.variants[0]!, task: CODING_TASKS[0]!.id, repetition: 0, signal: AbortSignal.abort(),
      createHarness: () => { created = true; throw new Error('must not launch') },
    })
    expect(created).toBe(false)
    expect(report.outcome).toBe('error')
    expect(report.cancelled).toBe(true)
    expect(report.deliveryMs).toBeNull()
  })

  it('does not count accepted artifacts as success when runtime cleanup fails', async () => {
    const task = CODING_TASKS[0]!
    const experiment = parseExperiment({ tasks: [task.id] }, 'scripted', process.cwd())
    let workspace = ''
    try {
      const report = await runDeliveryTrial({
        repositoryRoot: process.cwd(), artifactDirectory: process.cwd(), experiment,
        variant: experiment.variants[0]!, task: task.id, repetition: 0, signal: new AbortController().signal,
        createHarness: (options) => {
          workspace = options.cwd!
          return {
            start: () => Promise.resolve(),
            run: async () => {
              for (const [path, source] of Object.entries(task.solution)) await writeFile(join(workspace, path), source)
              return completed()
            },
            close: () => Promise.reject(new Error('runtime exit not confirmed')),
          }
        },
      })
      expect(report.verificationPassed).toBe(true)
      expect(report.outcome).toBe('error')
      expect(report.cleanupError).toBe('runtime exit not confirmed')
      expect(report.retainedWorkspace).toBe(dirname(workspace))
      await expect(readFile(join(workspace, 'package.json'))).resolves.toBeDefined()
    } finally {
      // The injected driver owns no process, so this test can remove the retained world safely.
      if (workspace !== '') await rm(dirname(workspace), { recursive: true, force: true })
    }
  })

  it.each([false, true])('propagates verifier cleanup failure including interruption=%s', async (interrupt) => {
    const experiment = parseExperiment({ deadlineMs: 100 }, 'scripted', process.cwd())
    const evaluator = vi.spyOn(acceptance, 'evaluateTask').mockImplementation(async (_task, _workspace, options) => {
      if (interrupt) {
        await new Promise<void>((resolve) => { options.signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      }
      return {
        passed: false, failureKind: 'infrastructure', detail: 'verification cleanup failed', checks: 0,
        timedOut: false, exitCode: 0, signal: null, cleanupError: 'verifier removal failed', retainedVerifierRoot: '/retained-verifier',
      }
    })
    try {
      const report = await runDeliveryTrial({
        repositoryRoot: process.cwd(), artifactDirectory: process.cwd(), experiment,
        variant: experiment.variants[0]!, task: CODING_TASKS[0]!.id, repetition: 0, signal: new AbortController().signal,
        createHarness: () => ({
          start: () => Promise.resolve(), run: () => Promise.resolve(completed()), close: () => Promise.resolve(),
        }),
      })
      expect(report.outcome).toBe(interrupt ? 'timed-out' : 'error')
      expect(report.cleanupError).toBe('verifier removal failed')
      expect(report.retainedWorkspace).toBeNull()
      expect(report.retainedVerifierRoot).toBe('/retained-verifier')
    } finally {
      evaluator.mockRestore()
    }
  })

  it('retains initialization errors rather than calling them failed coding tasks', async () => {
    const experiment = parseExperiment({}, 'scripted', process.cwd())
    const report = await runDeliveryTrial({
      repositoryRoot: process.cwd(), artifactDirectory: process.cwd(), experiment,
      variant: experiment.variants[0]!, task: CODING_TASKS[0]!.id, repetition: 0, signal: new AbortController().signal,
      createHarness: () => ({ start: () => Promise.reject(new Error('fixture startup failure')), run: () => Promise.resolve(completed()), close: () => Promise.resolve() }),
    })
    expect(report.outcome).toBe('error')
    expect(report.detail).toContain('fixture startup failure')
    expect(report.deliveryMs).toBeNull()
  })
})

describe('failure-aware scorecards', () => {
  it('keeps failures in the denominator and omits tiny-sample p95', () => {
    const reports = [sample('baseline', 'accepted', 100), { ...sample('baseline', 'timed-out', 1000), repetition: 1 }]
    expect(summarizeTrials(reports)).toEqual([{
      variant: 'baseline', attempted: 2, accepted: 1, failed: 0, timedOut: 1, errors: 0, cancelled: 0, cleanupErrors: 0,
      acceptedOnly: { samples: 1, medianMs: 100, p95Ms: null }, repairRounds: 0,
    }])
    expect(renderSummary(reports, 'scripted')).toContain('| baseline | 1 / 2 | 0 | 1 | 0 | 0 | 100.0 | — |')
    expect(renderSummary(reports, 'scripted')).toContain('Failed and timed-out trials are not latency samples.')
  })

  it('reports cleanup failure and variants whose scheduled trials never started', () => {
    const trials = [{ ...sample('b', 'timed-out', 100), cleanupError: 'shutdown failed' }]
    const rows = summarizeTrials(trials, ['a', 'b'])
    expect(rows[0]).toMatchObject({ variant: 'a', attempted: 0, accepted: 0 })
    expect(rows[1]).toMatchObject({ variant: 'b', timedOut: 1, cleanupErrors: 1 })
    expect(comparePairs(trials, 'a', ['a', 'b'])[0]).toMatchObject({ missingPairs: 1 })
    expect(renderSummary(trials, 'scripted', ['a', 'b'], 2)).toContain('Experiment incomplete. Cleanup failed; further trials stop.')
  })

  it('separates paired speed ratios from one-sided acceptance', () => {
    const trials = [sample('a', 'accepted', 100), sample('b', 'accepted', 50),
      { ...sample('a', 'accepted', 120), repetition: 1 }, { ...sample('b', 'failed', 10), repetition: 1 }]
    expect(comparePairs(trials, 'a')).toEqual([{
      baseline: 'a', candidate: 'b', bothAccepted: 1, baselineOnlyAccepted: 1, candidateOnlyAccepted: 0,
      neitherAccepted: 0, missingPairs: 0, acceptedPairMedianSpeedup: 2,
    }])
  })
})
