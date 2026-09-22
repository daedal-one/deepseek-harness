/** Required retained-memory budget for explicit tool details in a large shared history. */
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { runBuiltBenchmarkWorker } from '../support/built-worker.ts'
import type { HistoryDetailWorkerReport } from './history-detail.worker.client.ts'

const WORKER = join(import.meta.dirname, '..', '.dsh-build', 'conversation-fold', 'history-detail.worker.js')
// With 6,000 row readers, fresh processes retain ~2 MiB (typical) and ~8.4 MiB (tail), versus ~65.4 MiB unbounded.
// The 16 MiB tail budget allows a two-byte V8 representation and allocator variation.
const RETAINED_HEAP_BUDGET = { typical: 4 * 1024 * 1024, tail: 16 * 1024 * 1024 }

it.each(['typical', 'tail'] as const)('bounds %s detail retention while preserving the complete Session and Chat window', async (workload) => {
  for (let sample = 0; sample < 3; sample += 1) {
    const run = await runBuiltBenchmarkWorker<HistoryDetailWorkerReport>({
      worker: WORKER, args: [workload], timeoutMs: 60_000, exposeGc: true, heapLimitMb: 512,
    })
    expect(run.timedOut).toBe(false)
    expect(run.signal).toBeNull()
    expect(run.exitCode, run.stderr).toBe(0)
    const report = run.report
    expect(report).toBeDefined()
    if (report === undefined) throw new Error('history-detail worker did not report a sample')
    console.log(JSON.stringify({ benchmark: 'conversation-fold/history-detail', sample, ...report, budget: RETAINED_HEAP_BUDGET[workload] }))
    expect(report.events).toBe(10_000)
    expect(report.chatNodes).toBe(6000)
    expect(report.serializedChars).toBeLessThanOrEqual(report.maxSerializedChars)
    expect(report.retainedHeap).toBeLessThanOrEqual(RETAINED_HEAP_BUDGET[workload])
  }
})
