/** Failure-aware summaries; accepted-only latency never hides the trial denominator. */

import type { DeliveryTrial } from './types.ts'

/** Summarize every observed outcome and label latency as conditional on acceptance. */
export function summarizeTrials(trials: readonly DeliveryTrial[], variants = [...new Set(trials.map(trial => trial.variant))]) {
  return variants.map(variant => {
    const selected = trials.filter(trial => trial.variant === variant)
    const accepted = selected.filter(trial => trial.outcome === 'accepted')
    const durations = accepted.flatMap(trial => trial.deliveryMs === null ? [] : [trial.deliveryMs]).sort((a, b) => a - b)
    return {
      variant,
      attempted: selected.length,
      accepted: accepted.length,
      failed: selected.filter(trial => trial.outcome === 'failed').length,
      timedOut: selected.filter(trial => trial.outcome === 'timed-out').length,
      errors: selected.filter(trial => trial.outcome === 'error').length,
      cancelled: selected.filter(trial => trial.cancelled).length,
      cleanupErrors: selected.filter(trial => trial.cleanupError !== null).length,
      acceptedOnly: {
        samples: durations.length,
        medianMs: median(durations),
        p95Ms: durations.length < 20 ? null : durations[Math.ceil(durations.length * 0.95) - 1],
      },
      repairRounds: selected.reduce((sum, trial) => sum + trial.repairRounds, 0),
    }
  })
}

/** Compare matched task/repetition pairs without inventing times for failures or missing trials. */
export function comparePairs(trials: readonly DeliveryTrial[], baseline: string, variants = [...new Set(trials.map(trial => trial.variant))]) {
  const controls = trials.filter(trial => trial.variant === baseline)
  return variants.filter(variant => variant !== baseline).map(variant => {
    let bothAccepted = 0
    let baselineOnlyAccepted = 0
    let candidateOnlyAccepted = 0
    let neitherAccepted = 0
    let missingPairs = 0
    const ratios: number[] = []
    const candidates = trials.filter(trial => trial.variant === variant)
    const keys = [...new Set([...controls, ...candidates].map(trial => JSON.stringify([trial.task, trial.repetition])))]
    for (const key of keys) {
      const control = controls.find(trial => JSON.stringify([trial.task, trial.repetition]) === key)
      const candidate = candidates.find(trial => JSON.stringify([trial.task, trial.repetition]) === key)
      if (control === undefined || candidate === undefined) { missingPairs++; continue }
      if (control.outcome === 'accepted' && candidate.outcome === 'accepted') {
        bothAccepted++
        if (control.deliveryMs !== null && candidate.deliveryMs !== null && candidate.deliveryMs > 0) ratios.push(control.deliveryMs / candidate.deliveryMs)
      } else if (control.outcome === 'accepted') baselineOnlyAccepted++
      else if (candidate.outcome === 'accepted') candidateOnlyAccepted++
      else neitherAccepted++
    }
    ratios.sort((a, b) => a - b)
    return { baseline, candidate: variant, bothAccepted, baselineOnlyAccepted, candidateOnlyAccepted, neitherAccepted, missingPairs, acceptedPairMedianSpeedup: median(ratios) }
  })
}

/** Render the local report without claiming a statistically established winner. */
export function renderSummary(trials: readonly DeliveryTrial[], mode: string, variants?: string[], plannedTrials = trials.length): string {
  const rows = summarizeTrials(trials, variants)
  const incomplete = trials.length < plannedTrials ? ' Experiment incomplete.' : ''
  const cleanup = trials.some(trial => trial.cleanupError !== null)
    ? ' Cleanup failed; further trials stop. Inspect retainedWorkspace and retainedVerifierRoot in report.json before manual cleanup.' : ''
  return [
    '# Coding delivery report', '',
    `Mode: ${mode}. Delivery includes model work, tools, verification, and repairs; boot and cleanup are separate.`, '',
    `Trials observed: ${trials.length} / ${plannedTrials}.${incomplete}${cleanup}`, '',
    '| Variant | Accepted / attempted | Failed | Timed out | Errors | Cleanup errors | Accepted-only median (ms) | Accepted-only p95 (ms) |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...rows.map(row => `| ${row.variant} | ${row.accepted} / ${row.attempted} | ${row.failed} | ${row.timedOut} | ${row.errors} | ${row.cleanupErrors} | ${format(row.acceptedOnly.medianMs)} | ${format(row.acceptedOnly.p95Ms ?? null)} |`),
    '',
    'p95 is omitted below 20 accepted samples. These descriptive statistics carry no confidence interval or automatic winner verdict. Failed and timed-out trials are not latency samples.',
    '',
    'Raw trials and diagnostic spans are in report.json. Runtime spans use the runtime wall clock; controller phases use its monotonic clock. They must not be added together or presented as an inferred critical path.',
    '',
    'Scripted runs measure local plumbing, not model quality or provider latency. This small synthetic corpus does not establish general coding performance.',
    '',
  ].join('\n')
}

function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] ?? null : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

function format(value: number | null): string { return value === null ? '—' : value.toFixed(1) }
