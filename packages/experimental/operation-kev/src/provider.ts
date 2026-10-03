/**
 * Opt-in two-phase Kev provider: official preparation precedes the runner's durable barrier.
 * @module @deepseek-ai/dsh-experimental-operation-kev/provider
 */

import { deepFreeze, type JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  canonicalJson,
  digestJson,
  type OperationJudgmentDraft,
  type OperationJudgmentIdentity,
  type OperationJudgmentProvider,
  type OperationJudgmentResponse,
  type OperationPreparedJudgment,
} from '@deepseek-ai/dsh-experimental-operation'
import { LocalHttpClient } from '@deepseek-ai/dsh-experimental-operation-clm/local-http'
import { resolveConfig, type Config } from './config.ts'
import { KevWireError, parseDecision, parsePreparation, serviceIdentity } from './wire.ts'

/** Drainable private local provider without generation or tool authority. */
export class KevHttpProvider implements OperationJudgmentProvider {
  readonly identity: OperationJudgmentIdentity
  private readonly config: Config
  private readonly client: LocalHttpClient

  /** @param config Explicit reviewed deployment. @param resolveCredential Per-request secret lookup. */
  constructor(config: Config, resolveCredential?: () => Promise<string | undefined>) {
    this.config = resolveConfig(config)
    config = this.config
    this.client = new LocalHttpClient(config, resolveCredential)
    this.identity = deepFreeze({
      provider: config.providerId, model: config.model, encoder: config.encoder, tokenizer: config.tokenizerId,
      serialization: config.serialization, deployment: config.deployment, deploymentManifest: config.deploymentManifest,
      ...(config.calibrationId === undefined ? {} : { calibrationId: config.calibrationId }),
      configurationDigest: digestJson({ protocol: 'kev-local-v1', config: config as unknown as JsonValue }),
    })
  }

  /**
   * Serialize once and obtain official-encoder evidence without invoking the decision route.
   * @param draft Complete runner-owned state, question, and candidate descriptions.
   * @param signal Caller cancellation.
   * @returns Frozen request record containing the exact decision envelope.
   */
  async prepare(draft: OperationJudgmentDraft, signal: AbortSignal): Promise<OperationPreparedJudgment> {
    const detached = deepFreeze(structuredClone(draft))
    const request = JSON.stringify(this.officialRequest(detached))
    const raw = await this.client.post('/v1/prepare', { version: 1, deployment: this.config.deployment, request }, signal)
    const { wire, inputTokens } = parsePreparation(raw, request, this.config)
    return deepFreeze({ draft: detached, wire, inputTokens, identity: this.identity })
  }

  /**
   * Rank validated preparation contents after the caller's persistence barrier; send the retained exact model text.
   * @param prepared Previously recorded preparation; lossless copies are accepted.
   * @param signal Caller cancellation.
   * @returns Validated scores, untouched raw result, and honest optional usage.
   */
  async rank(prepared: OperationPreparedJudgment, signal: AbortSignal): Promise<OperationJudgmentResponse> {
    prepared = deepFreeze(structuredClone(prepared))
    if (canonicalJson(prepared.identity as unknown as JsonValue) !== canonicalJson(this.identity as unknown as JsonValue)) {
      throw new KevWireError('Kev prepared identity does not match this provider')
    }
    const wire = prepared.wire
    if (wire === null || typeof wire !== 'object' || Array.isArray(wire) || typeof wire.request !== 'string'
      || Object.keys(wire).sort().join(',') !== 'deployment,preparation,request,version'
      || wire.version !== 1 || wire.deployment !== this.config.deployment) {
      throw new KevWireError('Kev prepared wire does not match the complete decision envelope')
    }
    let request: JsonValue
    try { request = JSON.parse(wire.request) as JsonValue } catch { throw new KevWireError('Kev prepared request is not complete JSON') }
    const expected = this.officialRequest(prepared.draft)
    if (canonicalJson(request) !== canonicalJson(expected)) throw new KevWireError('Kev prepared request does not match its draft')
    // Canonical equality verifies the contents, but the official encoder also observes criteria insertion order.
    const parsed = request as typeof expected
    const actualKeys = Object.keys(parsed.questions.transition.criteria)
    const expectedKeys = Object.keys(expected.questions.transition.criteria)
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
      throw new KevWireError('Kev prepared candidate order does not match its draft')
    }
    const validated = parsePreparation({
      version: 1, deployment: this.config.deployment, identity: serviceIdentity(this.config), preparation: wire.preparation,
    }, wire.request, this.config)
    if (validated.inputTokens !== prepared.inputTokens) throw new KevWireError('Kev prepared input accounting does not match token evidence')
    const raw = await this.client.post('/v1/decision', wire, signal)
    return parseDecision(raw, prepared, this.config)
  }

  /** Stop admission and drain the provider's own HTTP requests before unload settles. */
  async dispose(): Promise<void> {
    await this.client.dispose()
  }

  private officialRequest(draft: OperationJudgmentDraft) {
    if (draft.candidates.length < 1 || draft.candidates.length > this.config.serviceCaps.maxCandidates
      || new Set(draft.candidates.map(candidate => candidate.id)).size !== draft.candidates.length) {
      throw new KevWireError('Kev candidate set exceeds reviewed bounds or repeats an id')
    }
    return {
      model: this.config.wireModel, state: draft.state,
      questions: { transition: {
        type: 'choice', instructions: draft.question,
        criteria: Object.fromEntries(draft.candidates.map(candidate => [candidate.id, candidate.description])),
      } },
    }
  }
}
