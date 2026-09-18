/** Strict experiment parsing and reproducible paired execution order. */

import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { CODING_TASKS, taskById } from './tasks.ts'
import type { DeliveryExperiment, DeliveryMode, DeliveryVariant } from './types.ts'

/** Parse a local JSON experiment without accepting embedded credentials or unknown options. */
export function parseExperiment(value: unknown, mode: DeliveryMode, directory: string): DeliveryExperiment {
  const config = record(value, 'experiment', ['tasks', 'variants', 'repetitions', 'seed', 'deadlineMs', 'maxRepairs'])
  const tasks = config['tasks'] === undefined ? CODING_TASKS.map(task => task.id) : strings(config['tasks'], 'tasks')
  for (const task of tasks) taskById(task)
  if (new Set(tasks).size !== tasks.length) throw new Error('tasks must not repeat')
  const rawVariants = config['variants'] ?? (mode === 'scripted' ? [{ id: 'baseline' }] : undefined)
  if (!Array.isArray(rawVariants) || rawVariants.length === 0 || rawVariants.length > 16) {
    throw new Error('variants must contain 1–16 explicit configurations')
  }
  const variants = rawVariants.map((raw: unknown): DeliveryVariant => {
    const variant = record(raw, 'variant', ['id', 'provider', 'model', 'reasoningEffort', 'maxTokens', 'credentialEnv', 'patches', 'scriptedBehavior'])
    const id = text(variant['id'], 'variant.id')
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error('variant.id must be 1–64 letters, digits, underscores, or hyphens')
    const patches = variant['patches'] === undefined ? [] : strings(variant['patches'], 'variant.patches', true).map(path => resolve(directory, path))
    const effort = variant['reasoningEffort'] === undefined ? undefined : text(variant['reasoningEffort'], 'variant.reasoningEffort')
    const maxTokens = variant['maxTokens'] === undefined ? undefined : integer(variant['maxTokens'], 'variant.maxTokens', 1, 1_000_000)
    const behavior = variant['scriptedBehavior'] ?? 'solve'
    if (behavior !== 'solve' && behavior !== 'repair' && behavior !== 'fail' && behavior !== 'hang') {
      throw new Error('variant.scriptedBehavior must be solve, repair, fail, or hang')
    }
    if (mode === 'scripted') {
      if (patches.length > 0 || variant['provider'] !== undefined || variant['model'] !== undefined || variant['credentialEnv'] !== undefined || effort !== undefined) {
        throw new Error('scripted variants cannot select providers, credentials, patches, or reasoning effort')
      }
      return { id, provider: 'coding-bench', model: 'scripted', patches, scriptedBehavior: behavior, ...maxTokens === undefined ? {} : { maxTokens } }
    }
    if (variant['scriptedBehavior'] !== undefined) throw new Error('live variants cannot specify scriptedBehavior')
    const credentialEnv = text(variant['credentialEnv'], 'variant.credentialEnv')
    if (!/^[A-Z_][A-Z0-9_]*$/.test(credentialEnv)) throw new Error('variant.credentialEnv must be an environment variable name, not a credential')
    return {
      id, provider: text(variant['provider'], 'variant.provider'), model: text(variant['model'], 'variant.model'),
      credentialEnv, patches, scriptedBehavior: 'solve',
      ...effort === undefined ? {} : { reasoningEffort: effort },
      ...maxTokens === undefined ? {} : { maxTokens },
    }
  })
  if (new Set(variants.map(variant => variant.id)).size !== variants.length) throw new Error('variant ids must be unique')
  return {
    mode, tasks, variants,
    repetitions: integer(config['repetitions'] ?? 1, 'repetitions', 1, 100),
    seed: integer(config['seed'] ?? 1, 'seed', 0, 0xffff_ffff),
    deadlineMs: integer(config['deadlineMs'] ?? 120_000, 'deadlineMs', 100, 3_600_000),
    maxRepairs: integer(config['maxRepairs'] ?? 1, 'maxRepairs', 0, 10),
  }
}

/** A task/repetition block keeps each variant adjacent but randomizes its order reproducibly. */
export function trialSchedule(experiment: DeliveryExperiment): { task: string; variant: DeliveryVariant; repetition: number }[] {
  const schedule: { task: string; variant: DeliveryVariant; repetition: number }[] = []
  for (let repetition = 0; repetition < experiment.repetitions; repetition++) {
    for (const task of experiment.tasks) {
      const order = experiment.variants.map(variant => ({
        variant,
        key: createHash('sha256').update(JSON.stringify([experiment.seed, task, repetition, variant.id])).digest('hex'),
      })).sort((a, b) => a.key.localeCompare(b.key))
      for (const { variant } of order) schedule.push({ task, variant, repetition })
    }
  }
  return schedule
}

function record(value: unknown, name: string, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${name} must be an object`)
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${name} contains an unknown field: ${key}`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a nonempty string`)
  return value
}

function strings(value: unknown, name: string, empty = false): string[] {
  if (!Array.isArray(value) || (!empty && value.length === 0)) throw new Error(`${name} must be an array${empty ? '' : ' with at least one entry'}`)
  return value.map((item: unknown) => text(item, name))
}

function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer in [${min}, ${max}]`)
  }
  return value
}
