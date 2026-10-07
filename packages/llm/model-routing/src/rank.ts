/**
 * Pure ranking of one task class against one candidate set.
 *
 * Every decision is a function of the declared class and the candidates
 * supplied, so the same inputs always produce the same route and a resolution
 * can be replayed against a recorded candidate set.
 *
 * @module @deepseek-ai/dsh-model-routing/rank
 */

import type {
  CostBasis,
  ModelRejection,
  RoutingCandidate,
  RoutingEvidence,
  RoutingResult,
  RoutingRunnerUp,
  TaskClassId,
  TaskClassRequirements,
  TaskClassSpec,
} from './types.ts'

/**
 * Compile one model-id pattern into an anchored regular expression.
 * `*` matches any run of characters; every other character is literal, so a
 * pattern can never accidentally match more than the operator wrote.
 * @param pattern - the declared pattern.
 * @returns the anchored expression.
 */
function modelPatternRegExp(pattern: string): RegExp {
  let source = '^'
  for (const character of pattern) {
    source += character === '*' ? '.*' : character.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  }
  return new RegExp(`${source}$`, 'u')
}

/**
 * Whether one candidate id matches at least one declared pattern.
 * @param model - exact candidate model id.
 * @param patterns - the tier's declared patterns.
 * @returns true when any pattern matches the whole id.
 */
function matchesAnyPattern(model: string, patterns: readonly string[]): boolean {
  return patterns.some(pattern => modelPatternRegExp(pattern).test(model))
}

/**
 * Estimate the USD cost of one representative call on one candidate.
 * @param candidate - the candidate model.
 * @param basis - token counts of one representative call.
 * @returns the exact cost, or null when either required price is unusable.
 */
export function estimateCallUsd(candidate: RoutingCandidate, basis: CostBasis): number | null {
  const { inputUsdPerToken, outputUsdPerToken } = candidate
  if (inputUsdPerToken === null || outputUsdPerToken === null) return null
  if (!Number.isFinite(inputUsdPerToken) || !Number.isFinite(outputUsdPerToken)) return null
  if (inputUsdPerToken < 0 || outputUsdPerToken < 0) return null
  const cost = basis.inputTokens * inputUsdPerToken + basis.outputTokens * outputUsdPerToken
  return Number.isFinite(cost) ? cost : null
}

/**
 * Check one candidate against every stated hard requirement.
 * An unstated requirement constrains nothing; a requirement the candidate
 * cannot evidence — unknown context capacity, undeclared modalities — fails,
 * because a hard requirement must be provable rather than assumed.
 * @param candidate - the candidate model.
 * @param requirements - the class's stated requirements.
 * @returns null when the candidate is eligible, otherwise the failing reason.
 */
function requirementFailure(candidate: RoutingCandidate, requirements: TaskClassRequirements): string | null {
  const { minContextTokens, requiresReasoning, inputModalities } = requirements
  if (minContextTokens !== undefined) {
    if (candidate.contextTokens === undefined) {
      return `declares no context capacity, so it cannot satisfy a ${String(minContextTokens)}-token minimum`
    }
    if (candidate.contextTokens < minContextTokens) {
      return `context capacity ${String(candidate.contextTokens)} is below the required ${String(minContextTokens)}`
    }
  }
  if (requiresReasoning === true && !candidate.supportsReasoning) {
    return 'exposes no selectable reasoning levels'
  }
  if (inputModalities !== undefined && inputModalities.length > 0) {
    const declared = candidate.inputModalities
    if (declared === undefined) {
      return `declares no input modalities, so it cannot prove ${inputModalities.join(', ')} support`
    }
    for (const modality of inputModalities) {
      if (!declared.includes(modality)) return `does not accept the required input modality "${modality}"`
    }
  }
  return null
}

/** One eligible candidate paired with its estimated call cost. */
interface PricedCandidate {
  readonly candidate: RoutingCandidate
  readonly estimatedUsd: number
}

/**
 * Choose the cheapest candidate, breaking a price tie on ascending model id so
 * the outcome never depends on catalog order.
 * @param priced - eligible, priceable candidates of one tier.
 * @returns the winner and the nearest other candidate, when one exists.
 */
function cheapest(priced: readonly PricedCandidate[]): { readonly winner: PricedCandidate; readonly runnerUp?: RoutingRunnerUp } {
  const ordered = [...priced].sort((left, right) => left.estimatedUsd - right.estimatedUsd
    || (left.candidate.model < right.candidate.model ? -1 : 1))
  const winner = ordered[0]
  const second = ordered[1]
  /* v8 ignore next -- callers pass a match set they have already proved non-empty */
  if (winner === undefined) throw new Error('model routing: cheapest requires at least one candidate')
  return {
    winner,
    ...second === undefined ? {} : { runnerUp: { model: second.candidate.model, estimatedUsd: second.estimatedUsd } },
  }
}

/**
 * Resolve one task class against one candidate set.
 *
 * The order is: apply the hard requirements, take the highest-preference tier
 * that still has an eligible candidate, and select the cheapest priceable
 * candidate within it. A tier whose eligible candidates are all unpriceable
 * yields `unsatisfied` rather than an unranked guess, and an eligible model
 * matching no tier is reported in `observed` and never selected.
 *
 * @param taskClass - the class being resolved, repeated in the outcome.
 * @param spec - the declared class.
 * @param candidates - exact candidates offered by the provider scope.
 * @returns the selected route with its evidence, or an unsatisfied outcome naming the cause.
 */
export function rankTaskClass(
  taskClass: TaskClassId,
  spec: TaskClassSpec,
  candidates: readonly RoutingCandidate[],
): RoutingResult {
  const rejected: ModelRejection[] = []
  const eligible: RoutingCandidate[] = []
  for (const candidate of candidates) {
    const reason = requirementFailure(candidate, spec.requirements)
    if (reason === null) eligible.push(candidate)
    else rejected.push({ model: candidate.model, reason })
  }
  const observed = eligible
    .filter(candidate => !spec.tiers.some(tier => matchesAnyPattern(candidate.model, tier.modelPatterns)))
    .map(candidate => candidate.model)
  const evidence: RoutingEvidence = {
    eligible: eligible.map(candidate => candidate.model),
    observed,
    rejected,
  }

  if (eligible.length === 0) {
    return {
      kind: 'unsatisfied',
      taskClass,
      detail: `no candidate in scope satisfies the declared requirements of task class "${String(taskClass)}"`,
      ...evidence,
    }
  }

  for (const tier of spec.tiers) {
    const matched = eligible.filter(candidate => matchesAnyPattern(candidate.model, tier.modelPatterns))
    if (matched.length === 0) continue
    const priced: PricedCandidate[] = []
    for (const candidate of matched) {
      const estimatedUsd = estimateCallUsd(candidate, spec.costBasis)
      if (estimatedUsd === null) {
        rejected.push({ model: candidate.model, reason: `tier "${tier.name}" matched but the model publishes no usable price` })
        continue
      }
      priced.push({ candidate, estimatedUsd })
    }
    if (priced.length === 0) {
      return {
        kind: 'unsatisfied',
        taskClass,
        detail: `every candidate in tier "${tier.name}" of task class "${String(taskClass)}" publishes no usable price`,
        eligible: evidence.eligible,
        observed: evidence.observed,
        rejected,
      }
    }
    const { winner, runnerUp } = cheapest(priced)
    return {
      kind: 'selected',
      taskClass,
      tier: tier.name,
      winner: winner.candidate,
      estimatedUsd: winner.estimatedUsd,
      ...runnerUp === undefined ? {} : { runnerUp },
      eligible: evidence.eligible,
      observed: evidence.observed,
      rejected,
    }
  }

  return {
    kind: 'unsatisfied',
    taskClass,
    detail: `task class "${String(taskClass)}" observed ${String(observed.length)} eligible model(s) outside every declared preference tier: ${observed.join(', ')}`,
    ...evidence,
  }
}
