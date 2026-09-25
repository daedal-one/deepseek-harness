/** Controller-owned coding-delivery configuration and trial evidence. */

import type { AcceptanceResult } from './acceptance.ts'
import type { DeliveryTraceReport } from './trace.ts'

/** Explicit execution mode; scripted controls never select a network provider. */
export type DeliveryMode = 'scripted' | 'live'

/** One labelled route in a paired, sequential experiment. */
export interface DeliveryVariant {
  readonly id: string
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
  readonly maxTokens?: number
  readonly credentialEnv?: string
  readonly patches: readonly string[]
  readonly scriptedBehavior: 'solve' | 'repair' | 'fail' | 'hang'
}

/** Validated experiment; deadlines are execution bounds, not performance budgets. */
export interface DeliveryExperiment {
  readonly mode: DeliveryMode
  readonly tasks: readonly string[]
  readonly variants: readonly DeliveryVariant[]
  readonly repetitions: number
  readonly seed: number
  readonly deadlineMs: number
  readonly maxRepairs: number
}

/** One controller-clock interval, relative to trial startup. */
export interface DeliveryPhase {
  readonly name: 'boot' | 'agent' | 'verification' | 'cleanup'
  readonly round: number
  readonly startMs: number
  readonly durationMs: number
  readonly complete: boolean
}

/** Independent acceptance evidence for an idle candidate. */
export interface DeliveryCheck extends AcceptanceResult {
  readonly round: number
}

/** Complete trial, including negative outcomes and partial traces. */
export interface DeliveryTrial {
  readonly task: string
  readonly variant: string
  readonly repetition: number
  readonly outcome: 'accepted' | 'failed' | 'timed-out' | 'error'
  readonly timedOut: boolean
  readonly cancelled: boolean
  readonly verificationPassed: boolean
  readonly detail: string
  readonly cleanupError: string | null
  /** Private generated world retained when teardown cannot prove safe removal. */
  readonly retainedWorkspace: string | null
  readonly retainedVerifierRoot: string | null
  readonly bootMs: number
  readonly deliveryMs: number | null
  readonly cleanupMs: number
  readonly totalMs: number
  readonly repairRounds: number
  readonly checks: readonly DeliveryCheck[]
  /** Idle turn termination is evidence separate from artifact acceptance. */
  readonly agentTurns: readonly { round: number; reason: string }[]
  readonly phases: readonly DeliveryPhase[]
  readonly trace: DeliveryTraceReport
}
