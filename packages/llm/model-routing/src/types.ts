/**
 * Public vocabulary for the task-class model routing policy: what a class
 * requires, how an operator states a preference, and what one resolution
 * decided.
 *
 * @module @deepseek-ai/dsh-model-routing/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Stable identity of one deployment-declared task class.
 *
 * The id is opaque to the ranker and appears verbatim in decision evidence, so
 * a recorded decision stays readable after a deployment renames a class.
 */
export type TaskClassId = Branded<'TaskClassId'>

/**
 * Hard capability requirements. Every stated requirement must hold or the
 * candidate is not eligible; an unstated requirement constrains nothing.
 *
 * These are filters, not preferences: a candidate that fails one is removed
 * from consideration rather than ranked lower, which is what keeps a
 * resolution from silently landing on a model known to be incapable.
 */
export interface TaskClassRequirements {
  /**
   * Minimum context capacity in tokens. A candidate whose capacity is unknown
   * fails this requirement, because unknown capacity cannot prove it satisfies
   * a hard requirement.
   */
  minContextTokens?: number
  /** Whether the class requires adapter-exposed selectable reasoning levels. */
  requiresReasoning?: boolean
  /**
   * Input modalities the model must accept, matched exactly against the
   * adapter-declared set. A candidate that declares no modalities fails; an
   * empty list requires nothing.
   */
  inputModalities?: string[]
}

/**
 * One operator-declared preference tier.
 *
 * Tiers are ordered best-first by their position in
 * {@link TaskClassSpec.tiers}. A model matching an earlier tier always beats a
 * model matching a later one, whatever either costs.
 */
export interface PreferenceTier {
  /** Operator-facing tier name, repeated in decision evidence. */
  name: string
  /**
   * Patterns matched against the exact candidate model id, where `*` matches
   * any run of characters and every other character is literal. A pattern
   * names a model or a family — `deepseek/*` admits a new DeepSeek release
   * without a configuration edit.
   */
  modelPatterns: string[]
}

/**
 * Token counts of one representative call of a class.
 *
 * Prices are compared by pricing this call, so the basis is a stated modelling
 * assumption rather than an unexplained blend: two candidates are ranked by
 * what the deployment actually expects a call of this kind to cost. Both
 * counts must be non-negative and at least one must be positive.
 */
export interface CostBasis {
  /** Prompt tokens assumed for one representative call. */
  inputTokens: number
  /** Completion tokens assumed for one representative call. */
  outputTokens: number
}

/** One complete deployment-declared task class. */
export interface TaskClassSpec {
  /** Hard capability requirements. */
  requirements: TaskClassRequirements
  /** Ordered preference tiers, best first; must contain at least one tier. */
  tiers: PreferenceTier[]
  /** Token counts of one representative call, used to compare prices. */
  costBasis: CostBasis
}

/**
 * One candidate model offered by a provider, with the metadata and prices the
 * ranker needs. The catalog provider maps a provider's own reply into this
 * provider-neutral form.
 */
export interface RoutingCandidate {
  /** Exact provider-owned model id. */
  readonly model: string
  /** Context capacity in tokens, or absent when the provider does not state it. */
  readonly contextTokens?: number
  /** Whether the adapter exposes selectable reasoning levels for this model. */
  readonly supportsReasoning: boolean
  /** Adapter-declared input modalities, or absent when none are declared. */
  readonly inputModalities?: readonly string[]
  /** USD per prompt token, or null when the provider publishes no usable price. */
  readonly inputUsdPerToken: number | null
  /** USD per completion token, or null when the provider publishes no usable price. */
  readonly outputUsdPerToken: number | null
}

/** Why one candidate was removed from consideration. */
export interface ModelRejection {
  /** Exact model id. */
  readonly model: string
  /** Human-readable reason naming the requirement or condition that failed. */
  readonly reason: string
}

/** The nearest eligible candidate the winner beat on price. */
export interface RoutingRunnerUp {
  /** Exact model id of the runner-up. */
  readonly model: string
  /** Estimated USD cost of one representative call. */
  readonly estimatedUsd: number
}

/**
 * Evidence gathered while ranking, present on every outcome.
 *
 * A failed resolution is as informative as a successful one: `rejected` names
 * every candidate and the requirement it failed, so an unsatisfiable class can
 * be diagnosed without re-running the ranking.
 */
export interface RoutingEvidence {
  /** Exact ids of candidates that satisfied every hard requirement. */
  readonly eligible: readonly string[]
  /**
   * Eligible candidates matching no declared tier. These are reported, never
   * selected: adopting a family the operator has not expressed a preference
   * for stays an operator decision.
   */
  readonly observed: readonly string[]
  /** Every candidate removed from consideration, with its reason. */
  readonly rejected: readonly ModelRejection[]
}

/**
 * The outcome of resolving one task class against one candidate set.
 *
 * A discriminated union over `kind`, so a consumer switches on the tag and
 * never reads a winner that was not selected.
 */
export type RoutingResult =
  | ({
    readonly kind: 'selected'
    readonly taskClass: TaskClassId
    /** Name of the tier the winner matched. */
    readonly tier: string
    /** The selected candidate. */
    readonly winner: RoutingCandidate
    /** Estimated USD cost of one representative call on the winner. */
    readonly estimatedUsd: number
    /** The nearest eligible candidate beaten on price, when one exists. */
    readonly runnerUp?: RoutingRunnerUp
  } & RoutingEvidence)
  | ({
    readonly kind: 'unsatisfied'
    readonly taskClass: TaskClassId
    /** Why no candidate could be selected, naming the class and the cause. */
    readonly detail: string
  } & RoutingEvidence)
