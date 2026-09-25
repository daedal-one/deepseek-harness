/** Keyless delivery endpoint controls in the existing serial built-worker lane. */

import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { runBuiltBenchmarkWorker } from '../support/built-worker.ts'
import { CODING_TASKS } from './tasks.ts'
import type { DeliveryTrial } from './types.ts'

const worker = resolve(import.meta.dirname, '..', '.dsh-build', 'coding-delivery', 'coding-delivery.worker.js')

for (const task of CODING_TASKS) {
  it(`coding-delivery accepts independently checked ${task.id}`, async () => {
    const report = await run(task.id, 'solve')
    expect(report.outcome).toBe('accepted')
    expect(report.checks).toHaveLength(1)
    expect(report.checks[0]?.passed).toBe(true)
    expect(report.repairRounds).toBe(0)
    expect(report.trace.counts.toolCalls).toBeGreaterThan(0)
    expect(report.trace.counts.settledModelAttempts).toBe(3)
    expect(report.deliveryMs).toBeGreaterThan(0)
  })
}

it('coding-delivery retains failed acceptance and same-session repair time', async () => {
  const report = await run(CODING_TASKS[0]!.id, 'repair')
  expect(report.outcome).toBe('accepted')
  expect(report.checks.map(check => check.passed)).toEqual([false, true])
  expect(report.repairRounds).toBe(1)
  expect(report.trace.counts.settledModelAttempts).toBe(4)
})

it('coding-delivery rejects a model claiming success without changing code', async () => {
  const report = await run(CODING_TASKS[0]!.id, 'fail')
  expect(report.outcome).toBe('failed')
  expect(report.verificationPassed).toBe(false)
  expect(report.checks.every(check => !check.passed)).toBe(true)
})

it('coding-delivery bounds a stalled model and retains its partial trace', async () => {
  const report = await run(CODING_TASKS[0]!.id, 'hang')
  expect(report.outcome).toBe('timed-out')
  expect(report.timedOut).toBe(true)
  expect(report.verificationPassed).toBe(false)
  expect(report.trace.counts.stepsStarted).toBeGreaterThan(0)
})

async function run(task: string, behavior: string): Promise<DeliveryTrial> {
  // The outer fail-safe leaves headroom for the SDK's bounded shutdown ladder.
  const result = await runBuiltBenchmarkWorker<DeliveryTrial>({ worker, args: [task, behavior], timeoutMs: 120_000 })
  expect(result.timedOut, result.stderr).toBe(false)
  expect(result.signal, result.stderr).toBeNull()
  expect(result.exitCode, result.stderr).toBe(0)
  expect(result.report, result.stderr).toBeDefined()
  const report = result.report!
  expect(report.cleanupError).toBeNull()
  console.log(JSON.stringify({ codingDelivery: report }))
  return report
}
