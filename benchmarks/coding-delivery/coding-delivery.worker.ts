/** One keyless coding task through the built SDK/profile path. */

import { resolve } from 'node:path'
import { assertBuiltBenchmarkRuntime } from '../support/built-worker.ts'
import { parseExperiment } from './config.ts'
import { runDeliveryTrial } from './runner.ts'

assertBuiltBenchmarkRuntime(import.meta.url, { '@deepseek-ai/dsh-sdk-client': import.meta.resolve('@deepseek-ai/dsh-sdk-client') })
const [task, behavior = 'solve'] = process.argv.slice(2)
if (task === undefined) throw new Error('usage: coding-delivery.worker.js <task> [solve|repair|fail|hang]')
const experiment = parseExperiment({
  tasks: [task], variants: [{ id: 'control', scriptedBehavior: behavior }],
  deadlineMs: behavior === 'hang' ? 500 : 15_000,
}, 'scripted', process.cwd())
const variant = experiment.variants[0]
if (variant === undefined) throw new Error('missing control variant')
const controller = new AbortController()
const abort = (): void => controller.abort()
process.once('SIGTERM', abort)
process.once('SIGINT', abort)
try {
  const report = await runDeliveryTrial({
    repositoryRoot: resolve(import.meta.dirname, '..', '..', '..'), artifactDirectory: import.meta.dirname,
    experiment, variant, task, repetition: 0, signal: controller.signal,
  })
  process.stdout.write(JSON.stringify(report) + '\n')
} finally {
  process.removeListener('SIGTERM', abort)
  process.removeListener('SIGINT', abort)
}
