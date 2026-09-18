/** Local experiment command; measured agents launch only through built dsh profiles. */

import { parseArgs } from 'node:util'
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { availableParallelism, cpus } from 'node:os'
import { assertBuiltBenchmarkRuntime } from '../benchmarks/support/built-worker.ts'
import { parseExperiment, trialSchedule } from '../benchmarks/coding-delivery/config.ts'
import { comparePairs, renderSummary, summarizeTrials } from '../benchmarks/coding-delivery/report.ts'
import { runDeliveryTrial } from '../benchmarks/coding-delivery/runner.ts'
import { CODING_TASKS } from '../benchmarks/coding-delivery/tasks.ts'
import type { DeliveryTrial } from '../benchmarks/coding-delivery/types.ts'

const HELP = `Usage: pnpm benchmark:coding [--config experiment.json] [--output new-directory]
       pnpm benchmark:coding --live --allow-unconfined --config experiment.json

Default: keyless scripted model, three synthetic tasks, one repetition.
Build first with pnpm run build:bench. JSON configuration accepts tasks, variants,
repetitions, seed, deadlineMs, maxRepairs. Live variants require id, provider, model,
and credentialEnv (an environment variable NAME, never a secret value).

Live execution can incur API charges and runs generated code using sdk-minimal's
unconfined tools. Use a disposable container/VM; private directories are not a
security sandbox. Both --live and --allow-unconfined are required.
Reports retain outcomes and metadata, not source code or raw conversation text.
`

/** Run a sequential, reproducibly interleaved experiment and preserve all observed outcomes. */
export async function main(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: {
    config: { type: 'string' }, output: { type: 'string' },
    live: { type: 'boolean', default: false }, 'allow-unconfined': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  } })
  if (values.help) { process.stdout.write(HELP); return }
  if (values.live && !values['allow-unconfined']) throw new Error('live runs require --allow-unconfined; use a disposable container/VM')
  if (!values.live && values['allow-unconfined']) throw new Error('--allow-unconfined is meaningful only with --live')
  const configPath = values.config === undefined ? undefined : resolve(values.config)
  const input: unknown = configPath === undefined ? {} : JSON.parse(await readFile(configPath, 'utf8'))
  const experiment = parseExperiment(input, values.live ? 'live' : 'scripted', configPath === undefined ? process.cwd() : dirname(configPath))
  assertBuiltBenchmarkRuntime(import.meta.url, {
    '@deepseek-ai/dsh-sdk-client': import.meta.resolve('@deepseek-ai/dsh-sdk-client'),
  })
  const artifacts = import.meta.dirname
  const root = resolve(artifacts, '..', '..', '..')
  const cli = join(root, 'apps', 'cli', 'lib', 'bin.js')
  // Fail before starting an experiment when the supported built application is absent.
  await readFile(cli)
  const outputParent = values.output === undefined ? join(root, '.artifacts', 'coding-delivery') : dirname(resolve(values.output))
  await mkdir(outputParent, { recursive: true })
  const output = values.output === undefined
    ? await mkdtemp(join(outputParent, 'run-'))
    : resolve(values.output)
  if (values.output !== undefined) await mkdir(output, { mode: 0o700 })
  const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')
  const variants = await Promise.all(experiment.variants.map(async variant => ({
    id: variant.id, provider: variant.provider, model: variant.model,
    reasoningEffort: variant.reasoningEffort ?? null, maxTokens: variant.maxTokens ?? null,
    credentialEnv: variant.credentialEnv ?? null,
    scriptedBehavior: experiment.mode === 'scripted' ? variant.scriptedBehavior : null,
    patchHashes: await Promise.all(variant.patches.map(async path => hash(await readFile(path)))),
  })))
  const metadata = {
    schemaVersion: 1, createdAt: new Date().toISOString(), mode: experiment.mode,
    profile: 'sdk-minimal', toolOverlay: 'fs-local + str_replace_editor',
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    worktreeDirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0,
    node: process.version, platform: process.platform, arch: process.arch,
    cpuModels: [...new Set(cpus().map(cpu => cpu.model))], availableParallelism: availableParallelism(),
    artifactHashes: { cli: hash(await readFile(cli)), controller: hash(await readFile(pathToFileURL(join(artifacts, 'cli.js')))), adapter: hash(await readFile(join(artifacts, 'scripted-adapter.js'))) },
    corpusHash: hash(JSON.stringify(CODING_TASKS)),
    experiment: {
      tasks: experiment.tasks, variants, repetitions: experiment.repetitions,
      seed: experiment.seed, deadlineMs: experiment.deadlineMs, maxRepairs: experiment.maxRepairs,
    },
    clocks: { delivery: 'controller performance.now, first prompt through independent acceptance including repairs', spans: 'runtime event timestamps; separate clock domain' },
    exclusions: [
      'No browser, human approval timing, or full-profile performance claim.',
      'Provider queueing, prefill, serialization, and checkpoint costs are not separately instrumented.',
      'Provider cache state is not forced cold; unavailable token usage remains unreported.',
      'Only settled model attempts have stream timing; interrupted unsettled work may lack a request span.',
      'Small dependency-free corpus; no general coding-quality or statistical-significance claim.',
      'No peak or retained-memory measurement; no cost estimate without provider pricing.',
      'Entry artifact hashes are not a fingerprint of the complete transitive runtime build.',
    ],
  }
  const trials: DeliveryTrial[] = []
  const controller = new AbortController()
  const interrupt = (): void => { controller.abort() }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  const schedule = trialSchedule(experiment)
  try {
    await writeFile(join(output, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    for (const entry of schedule) {
      if (controller.signal.aborted) break
      const trial = await runDeliveryTrial({
        repositoryRoot: root, artifactDirectory: artifacts, experiment, ...entry, signal: controller.signal,
        patchHashes: variants.find(variant => variant.id === entry.variant.id)?.patchHashes ?? [],
      })
      trials.push(trial)
      await appendFile(join(output, 'trials.jsonl'), JSON.stringify(trial) + '\n', { mode: 0o600 })
      process.stdout.write(`${entry.task} / ${entry.variant.id} / ${entry.repetition + 1}: ${trial.outcome}\n`)
      if (trial.cleanupError !== null) break
    }
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
    const report = {
      ...metadata, plannedTrials: schedule.length, completedTrials: trials.length,
      interrupted: controller.signal.aborted, incomplete: trials.length !== schedule.length,
      trials, summary: summarizeTrials(trials, variants.map(variant => variant.id)),
      comparisons: comparePairs(trials, experiment.variants[0]?.id ?? '', variants.map(variant => variant.id)),
    }
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    const summary = renderSummary(trials, experiment.mode, variants.map(variant => variant.id), schedule.length)
    await writeFile(join(output, 'report.md'), summary, { flag: 'wx', mode: 0o600 })
    process.stdout.write(`Report: ${join(output, 'report.json')}\n`)
  }
  if (controller.signal.aborted || trials.some(trial => trial.outcome !== 'accepted')) process.exitCode = 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
