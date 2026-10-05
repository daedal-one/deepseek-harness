/**
 * Operation plan, judgment, replay, and durable-record vocabulary.
 * @module @deepseek-ai/dsh-experimental-operation/types
 */

import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { OperationCandidateId, OperationJudgmentRequestId, OperationRunId } from './ids.ts'

export type { OperationCandidateId, OperationJudgmentRequestId, OperationRunId } from './ids.ts'

/**

 * Complete version-one operation plan after wire parsing.

 */
export interface OperationPlan {
  /**
   * Wire language version.
   */
  readonly version: 1
  /**
   * Bounded display name.
   */
  readonly name: string
  /**
   * Planner-owned goal supplied to semantic checkpoints.
   */
  readonly goal: string
  /**
   * Immutable named JSON inputs.
   */
  readonly inputs: Readonly<Record<string, JsonValue>>
  /**
   * Ordered steps; the runner never branches or reorders them.
   */
  readonly steps: readonly OperationStep[]
  /**
   * Declared checks and semantic question required for completion.
   */
  readonly completion: OperationCompletion
  /**
   * Optional tighter limits requested by the plan.
   */
  readonly requestedLimits?: Partial<OperationLimits>
}

/**

 * One fixed-tool sequential plan step.

 */
export interface OperationStep {
  /**
   * Unique stable step identifier.
   */
  readonly id: string
  /**
   * Human-readable purpose included in the checkpoint state.
   */
  readonly purpose: string
  /**
   * Exact registered tool name.
   */
  readonly tool: string
  /**
   * Complete argument expression.
   */
  readonly arguments: OperationExpression
  /**
   * Required deterministic assertions after canonical tool output.
   */
  readonly assertions: readonly OperationAssertion[]
  /**
   * Exact post-policy evidence selectors.
   */
  readonly observation: OperationObservationSpec
  /**
   * Semantic question supplied to the bounded judgment provider.
   */
  readonly question: string
}

/**

 * Final deterministic verification and semantic completion checkpoint.

 */
export interface OperationCompletion {
  /**
   * Assertions that must all pass before completion ranking.
   */
  readonly assertions: readonly OperationAssertion[]
  /**
   * Result references constituting declared completion evidence.
   */
  readonly evidence: readonly OperationExpression[]
  /**
   * Semantic question that may select completion only after deterministic checks pass.
   */
  readonly question: string
}

/**

 * Declared canonical evidence paths for one successful step.

 */
export interface OperationObservationSpec {
  /**
   * JSON Pointers into this step's canonical result.
   */
  readonly paths: readonly string[]
  /**
   * Optional JSON Pointer to the complete record collection for next-step selection.
   */
  readonly candidates?: string
}

/**

 * Tagged expression language with no interpolation, evaluation, or host-property access.

 */
export type OperationExpression =
  | { readonly kind: 'literal'; readonly value: JsonValue }
  | { readonly kind: 'input'; readonly input: string; readonly pointer: string }
  | { readonly kind: 'result'; readonly step: string; readonly pointer: string }
  | { readonly kind: 'selected'; readonly step: string; readonly pointer: string }
  | { readonly kind: 'object'; readonly properties: Readonly<Record<string, OperationExpression>> }
  | { readonly kind: 'array'; readonly items: readonly OperationExpression[] }

/**

 * Deterministic JSON assertion accepted by version-one plans.

 */
export type OperationAssertion =
  | { readonly kind: 'present'; readonly value: OperationExpression }
  | { readonly kind: 'type'; readonly value: OperationExpression; readonly type: OperationJsonType }
  | { readonly kind: 'equals'; readonly left: OperationExpression; readonly right: OperationExpression }
  | { readonly kind: 'oneOf'; readonly value: OperationExpression; readonly values: readonly JsonValue[] }
  | { readonly kind: 'number'; readonly value: OperationExpression; readonly min?: number; readonly max?: number }
  | { readonly kind: 'size'; readonly value: OperationExpression; readonly min?: number; readonly max?: number }

/**

 * JSON type names used by the typed assertion.

 */
export type OperationJsonType = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object'

/**

 * Fully resolved deployment limits frozen in every run-start event.

 */
export interface OperationLimits {
  /**
   * Maximum canonical bytes of the submitted plan.
   */
  readonly maxPlanBytes: number
  /**
   * Maximum finite sequential step count.
   */
  readonly maxSteps: number
  /**
   * Maximum wall-clock duration for the whole run.
   */
  readonly maxWallMs: number
  /**
   * Maximum cooperative deadline for one tool dispatch.
   */
  readonly maxToolDeadlineMs: number
  /**
   * Maximum cooperative deadline for one judgment request.
   */
  readonly maxJudgmentDeadlineMs: number
  /**
   * Maximum tool calls accepted by one run.
   */
  readonly maxToolCalls: number
  /**
   * Maximum judgment calls accepted by one run.
   */
  readonly maxJudgments: number
  /**
   * Maximum bytes in one canonical successful result.
   */
  readonly maxResultBytes: number
  /**
   * Maximum bytes in one complete selected observation.
   */
  readonly maxObservationBytes: number
  /**
   * Maximum supplied complete action candidates.
   */
  readonly maxCandidates: number
  /**
   * Maximum bytes in one candidate action description.
   */
  readonly maxCandidateBytes: number
  /**
   * Maximum exact input tokens admitted across judgment requests.
   */
  readonly maxJudgmentInputTokens: number
  /**
   * Maximum provider-reported output tokens admitted across judgment requests.
   */
  readonly maxJudgmentOutputTokens: number
  /**
   * Minimum top probability required for an autonomous continuation.
   */
  readonly minimumProbability: number
  /**
   * Minimum top-minus-runner-up probability required for an autonomous continuation.
   */
  readonly minimumMargin: number
  /**
   * Whether provider identity must carry a calibration identifier.
   */
  readonly requireCalibration: boolean
}

/**

 * Immutable tool-schema identity captured during admission.

 */
export interface OperationToolIdentity {
  /**
   * Registered fixed tool name.
   */
  readonly name: string
  /**
   * SHA-256 digest of the canonical parameter and output schemas.
   */
  readonly schemaDigest: string
  /** Canonical schemas used by schemaDigest; absent on earlier v1 records. */
  readonly schemas?: { readonly parameters: JsonValue; readonly output: JsonValue }
}

/**

 * Provenance for one resolved expression value.

 */
export interface OperationValueProvenance {
  /**
   * Source category for a resolved leaf.
   */
  readonly kind: 'literal' | 'input' | 'result' | 'selected'
  /**
   * Source step when the value comes from a result or selected record.
   */
  readonly step?: string
  /**
   * Named input when the value comes from an input.
   */
  readonly input?: string
  /**
   * JSON Pointer resolved without coercion.
   */
  readonly pointer?: string
}

/**

 * One complete canonical observation value and its exact source.

 */
export interface OperationObservation {
  /**
   * Step that produced the canonical result.
   */
  readonly step: string
  /**
   * JSON Pointer within that canonical result.
   */
  readonly pointer: string
  /**
   * Detached complete source value.
   */
  readonly value: JsonValue
}

/**

 * One candidate that binds every selected argument to one source record.

 */
export interface OperationActionCandidate {
  /**
   * Provider-visible opaque response key.
   */
  readonly id: OperationCandidateId
  /**
   * Candidate control effect owned by the runner.
   */
  readonly kind: 'continue' | 'needs-replan' | 'stop' | 'complete'
  /**
   * Fixed following step for a continuation.
   */
  readonly nextStep?: string
  /**
   * Complete resolved next-tool arguments for a continuation.
   */
  readonly arguments?: JsonValue
  /**
   * Candidate source record identity when a selected expression supplied values.
   */
  readonly source?: OperationObservation
  /**
   * Bounded exact description sent to the provider.
   */
  readonly description: string
}

/**

 * Locally verified deployment manifest identity.

 */
export interface OperationDeploymentManifestVerification {
  /**
   * Operator-owned manifest location or immutable registry reference.
   */
  readonly reference: string
  /**
   * Digest of the reviewed immutable manifest.
   */
  readonly digest: string
}

/**

 * Provider/deployment identity frozen before the first semantic request.

 */
export interface OperationJudgmentIdentity {
  /**
   * Provider-owned stable route identifier.
   */
  readonly provider: string
  /**
   * Immutable ranking model identifier.
   */
  readonly model: string
  /**
   * Immutable encoder identity.
   */
  readonly encoder: string
  /**
   * Exact tokenizer identity used for input accounting.
   */
  readonly tokenizer: string
  /**
   * Exact request serialization recipe.
   */
  readonly serialization: string
  /**
   * Immutable deployment or artifact digest.
   */
  readonly deployment: string
  /**
   * Explicit local verification of the pinned deployment manifest.
   */
  readonly deploymentManifest?: OperationDeploymentManifestVerification
  /**
   * Calibration identity required when autonomous acceptance is enabled.
   */
  readonly calibrationId?: string
  /** Canonical digest of explicit nonsecret resolved provider settings, when available. */
  readonly configurationDigest?: string
}

/**

 * Closed ranking input built only by the operation runner.

 */
export interface OperationJudgmentDraft {
  /**
   * Request identity minted by the runner.
   */
  readonly id: OperationJudgmentRequestId
  /**
   * Owning operation run.
   */
  readonly runId: OperationRunId
  /**
   * Checkpoint category.
   */
  readonly kind: 'continuation' | 'completion'
  /**
   * Complete semantic state assembled from canonical values.
   */
  readonly state: JsonValue
  /**
   * Named ranking question.
   */
  readonly question: string
  /**
   * Supplied closed action set.
   */
  readonly candidates: readonly OperationActionCandidate[]
}

/**

 * Provider-prepared bounded request that can be recorded before inference.

 */
export interface OperationPreparedJudgment {
  /**
   * Runner-owned logical request.
   */
  readonly draft: OperationJudgmentDraft
  /**
   * Exact outbound JSON wire payload.
   */
  readonly wire: JsonValue
  /**
   * Per-text encoder accounting and the reviewed server ceiling, when the provider uses independent text encoders.
   */
  readonly encoding?: {
    readonly maxTokensPerText: number
    readonly inputs: readonly { readonly text: string; readonly tokens: number }[]
  }
  /**
   * Exact complete input accounting from the configured encoder, independent of cache-dependent provider usage.
   */
  readonly inputTokens: number
  /**
   * Provider identity pinned to this request.
   */
  readonly identity: OperationJudgmentIdentity
}

/**

 * Provider response after bounded wire parsing.

 */
export interface OperationJudgmentResponse {
  /**
   * Runner request identity associated locally with the provider response.
   */
  readonly requestId: OperationJudgmentRequestId
  /**
   * Locally pinned provider identity associated with the response.
   */
  readonly identity: OperationJudgmentIdentity
  /**
   * Complete probability distribution keyed only by supplied candidate ids.
   */
  readonly probabilities: Readonly<Record<string, number>>
  /**
   * Provider-reported token and billing accounting when available.
   */
  readonly usage?: { readonly billingUnits?: number; readonly inputTokens: number; readonly outputTokens: number }
  /**
   * Provider-reported choice confidence, retained separately from local acceptance margins.
   */
  readonly providerConfidence?: number
  /** Complete provider response after strict wire parsing, when available. */
  readonly wire?: JsonValue
  /**
   * Provider-measured processing time when supplied.
   */
  readonly providerLatencyMs?: number
}

/**

 * Pluggable exact tokenizer selected by CLM provider configuration.

 */
export interface OperationTokenizer {
  /**
   * Immutable tokenizer/encoding recipe identifier.
   */
  readonly id: string
  /**
   * Count tokens in one exact encoder input text.
   * @param text Exact encoder input.
   * @param signal Cancellation signal.
   * @returns Non-negative safe token count.
   */
  count(text: string, signal: AbortSignal): Promise<number>
  /**
   * Count every complete input in order; counts include deployed special-token framing, not cache misses.
   * @param texts Exact independently encoded inputs.
   * @param signal Cancellation signal.
   * @returns One non-negative safe token count per input in its original order.
   */
  countMany?(texts: readonly string[], signal: AbortSignal): Promise<readonly number[]>
}

/**

 * Bounded ranking provider with no generation, tool, approval, or plan authority.

 */
export interface OperationJudgmentProvider {
  /**
   * Immutable provider/model/encoder/serialization identity.
   */
  readonly identity: OperationJudgmentIdentity
  /**
   * Prepare a request and calculate its exact input token count without inference.
   * @param draft Complete runner-owned request.
   * @param signal Cancellation signal.
   * @returns Recordable prepared request.
   */
  prepare(draft: OperationJudgmentDraft, signal: AbortSignal): Promise<OperationPreparedJudgment>
  /**
   * Rank only the supplied candidates.
   * @param prepared Previously recorded request.
   * @param signal Cancellation signal.
   * @returns Complete bounded ranking response.
   */
  rank(prepared: OperationPreparedJudgment, signal: AbortSignal): Promise<OperationJudgmentResponse>
}

/**

 * Terminal state produced by the finite sequential runner.

 */
export type OperationStatus = 'completed' | 'needs-replan' | 'stopped' | 'failed' | 'cancelled'

/**

 * Stable model-facing summary returned for non-infrastructure terminal states.

 */
export interface OperationSummary {
  /** Last complete declared canonical observations, when the deployment enables planner feedback. */
  readonly observations?: readonly OperationObservation[]
  /**
   * Operation run identity.
   */
  readonly runId: OperationRunId
  /**
   * Distinct completion, replan, stop, failure, and cancellation status.
   */
  readonly status: OperationStatus
  /**
   * Every started fixed step in order.
   */
  readonly attemptedSteps: readonly string[]
  /**
   * Every successful deterministic step in order.
   */
  readonly completedSteps: readonly string[]
  /**
   * Machine-readable terminal reason.
   */
  readonly reason: string
  /**
   * Full declared deterministic verification evidence.
   */
  readonly verification: readonly OperationAssertionResult[]
}

/**

 * One assertion outcome retained in operation records and summaries.

 */
export interface OperationAssertionResult {
  /**
   * Original assertion position.
   */
  readonly index: number
  /**
   * Whether the assertion passed.
   */
  readonly passed: boolean
  /**
   * Stable reason text for failures.
   */
  readonly reason: string
}

/**

 * Durable run admission record.

 */
export interface OperationRunStartEventData {
  readonly version: 1
  readonly runId: OperationRunId
  readonly rootCallId: ToolCallId
  readonly plan: OperationPlan
  readonly planDigest: string
  readonly limits: OperationLimits
  readonly toolIdentities: readonly OperationToolIdentity[]
  readonly judgmentIdentity: OperationJudgmentIdentity
  /** Stable session and immediate outer call, not process-local execution tokens; absent on earlier v1 records. */
  readonly caller?: { readonly sessionId: SessionId; readonly callId: ToolCallId }
  /** Sorted unique effective exclusions, including the unconditional run_operation exclusion; absent on earlier v1 records. */
  readonly configuration?: { readonly forbiddenTools: readonly string[] }
  /** digestJson({ limits, forbiddenTools, judgmentIdentity }); excludes volatile correlation IDs. Absent on earlier v1 records. */
  readonly configurationDigest?: string
}

/**

 * Durable step intent, complete arguments, and selection provenance.

 */
export interface OperationStepStartEventData {
  readonly version: 1
  readonly runId: OperationRunId
  readonly stepId: string
  readonly tool: string
  readonly callId: ToolCallId
  readonly arguments: JsonValue
  readonly bindings: readonly OperationValueProvenance[]
  /** Admitted schema identity; absent on earlier v1 records. */
  readonly schemaDigest?: string
  /** digestJson(arguments); absent on earlier v1 records. */
  readonly argumentsDigest?: string
}

/**

 * Durable post-policy canonical tool outcome flushed before terminal handling.

 */
export interface OperationStepResultEventData {
  readonly version: 1
  readonly runId: OperationRunId
  readonly stepId: string
  readonly isError: boolean
  readonly value?: JsonValue
  readonly rendered: JsonValue
  readonly error?: { readonly message: string; readonly code?: string }
  readonly elapsedMs: number
  readonly assertions: readonly OperationAssertionResult[]
  /** Exact nested intent correlation; absent on earlier v1 records. */
  readonly callId?: ToolCallId
  /** Admitted schema identity; absent on earlier v1 records. */
  readonly schemaDigest?: string
  /** digestJson(value) only when the canonical successful value is retained; absent on earlier v1 records. */
  readonly valueDigest?: string
  /** Independent registry-body and interruption facts after quiescence; absence on earlier v1 records does not prove no dispatch. */
  readonly execution?: OperationDispatchFacts
}

/** Independent settled dispatch facts, never inferred from tool error codes or prose. */
export interface OperationDispatchFacts {
  readonly body: 'started' | 'not-started'
  readonly callerCancelled: boolean
  readonly timedOut: boolean
  /** Whether the effective body signal was aborted, including ordinary around-wrapper deadlines; absent on earlier v1 records. */
  readonly bodySignalAborted?: boolean
}

/** Canonical evidence identity tied to its exact producing result and admitted schema. */
export interface OperationEvidenceFingerprint {
  readonly step: string
  readonly pointer: string
  readonly valueDigest: string
  readonly resultDigest: string
  readonly schemaDigest: string
}

/** Canonical checkpoint fingerprints exclude request/run/caller correlation IDs. */
export interface OperationJudgmentFingerprints {
  readonly stateDigest: string
  readonly candidatesDigest: string
  readonly observations: readonly OperationEvidenceFingerprint[]
  readonly candidateSources: readonly (OperationEvidenceFingerprint & { readonly candidateId: OperationCandidateId })[]
  readonly completionEvidenceDigest: string
}

/**

 * Durable complete input and candidate mapping before provider dispatch.

 */
export interface OperationJudgmentRequestEventData {
  readonly version: 1
  readonly runId: OperationRunId
  readonly request: OperationPreparedJudgment
  readonly remainingInputTokens: number
  readonly remainingOutputTokens: number
  /** Source-bound digests of complete checkpoint values; absent on earlier v1 records. */
  readonly fingerprints?: OperationJudgmentFingerprints
}

/**

 * Durable ranking output or caller, deadline, or provider failure after request dispatch.

 */
export interface OperationJudgmentResultEventData {
  readonly version: 1
  readonly runId: OperationRunId
  readonly requestId: OperationJudgmentRequestId
  readonly response?: OperationJudgmentResponse
  readonly error?: { readonly message: string; readonly code?: string }
  readonly elapsedMs: number
}

/**

 * Durable accepted or rejected checkpoint transition.

 */
export interface OperationTransitionEventData {
  readonly version: 1
  readonly runId: OperationRunId
  readonly requestId: OperationJudgmentRequestId
  readonly candidateId: OperationCandidateId
  readonly accepted: boolean
  readonly reason: string
  readonly nextStep?: string
  readonly arguments?: JsonValue
}

/**

 * Durable terminal summary and final verification state.

 */
export interface OperationRunEndEventData {
  readonly version: 1
  readonly runId: OperationRunId
  readonly status: OperationStatus
  readonly reason: string
  readonly attemptedSteps: readonly string[]
  readonly completedSteps: readonly string[]
  readonly verification: readonly OperationAssertionResult[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Opens one immutable operation admission record.
     * @param data Frozen plan, limits, identities, and caller correlation.
     */
    'operation/run-start': OperationRunStartEventData
    /**
     * Records complete next-effect intent before nested tool dispatch.
     * @param data Fixed tool, arguments, and expression provenance.
     */
    'operation/step-start': OperationStepStartEventData
    /**
     * Records and flushes the complete post-policy canonical step outcome before terminal handling.
     * @param data Canonical value or failure, rendering, timing, and assertions.
     */
    'operation/step-result': OperationStepResultEventData
    /**
     * Records and flushes exact ranking input before provider inference.
     * @param data Prepared wire input, candidate mapping, and remaining budgets.
     */
    'operation/judgment-request': OperationJudgmentRequestEventData
    /**
     * Records and flushes one provider ranking response or caller, deadline, or provider failure.
     * @param data Response/failure and elapsed timing.
     */
    'operation/judgment-result': OperationJudgmentResultEventData
    /**
     * Records the locally validated selected transition before its next effect.
     * @param data Candidate identity, acceptance outcome, and bound arguments.
     */
    'operation/transition': OperationTransitionEventData
    /**
     * Settles the operation after owned tool and provider work quiesces.
     * @param data Terminal status and declared verification evidence.
     */
    'operation/run-end': OperationRunEndEventData
  }
}
