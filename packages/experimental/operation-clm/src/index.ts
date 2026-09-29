/**
 * Opt-in CLM System One provider for the experimental operation judgment seam.
 * @module @deepseek-ai/dsh-experimental-operation-clm
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import type { OperationDeploymentManifestVerification } from '@deepseek-ai/dsh-experimental-operation'
import { ClmHttpProvider, type ClmHttpConfig } from './provider.ts'

export { ClmHttpError, ClmHttpProvider, validateConfig } from './provider.ts'
export type { ClmCredentialResolver, ClmFetch, ClmHttpConfig } from './provider.ts'
export { clmChoiceRequest, clmEncoderInputs, ClmWireError, clmStateText, parseClmChoiceResponse, serializeClmChoice } from './wire.ts'
export type { ClmChoiceRequest } from './wire.ts'

/**

 * Cordis plugin name used by Loader diagnostics.

 */
export const name = 'operation-clm'

/**

 * Operation service whose provider registry this adapter joins.

 */
export const inject = ['operations']

/**

 * CLM adapter configuration before defaults are resolved.

 */
export interface Config {
  /**
   * Exact absolute CLM System One endpoint.
   */
  endpoint: string
  /**
   * Exact tokenizer hook registered on `ctx.operations`.
   */
  tokenizerId: string
  /**
   * Immutable ranking model identity sent to CLM and pinned locally.
   */
  model: string
  /**
   * Immutable encoder identity recorded locally.
   */
  encoder: string
  /**
   * Immutable deployment digest recorded locally.
   */
  deployment: string
  /**
   * Local manifest reference and digest required for autonomous execution.
   */
  deploymentManifest?: OperationDeploymentManifestVerification
  /**
   * Optional calibration artifact identity.
   */
  calibrationId?: string
  /**
   * Optional credential reference resolved through `ctx.credentials` per request.
   */
  credentialRef?: string
  /**
   * Optional provider route identity.
   */
  providerId?: string
  /**
   * Optional serialization recipe identity.
   */
  serialization?: string
  /**
   * Required CLM softmax temperature.
   */
  temperature: number
  /**
   * Optional per-request deadline.
   */
  timeoutMs?: number
  /**
   * Optional complete response body cap.
   */
  maxResponseBytes?: number
}

/**

 * Loader schema for the explicit CLM identity and transport limits.

 */
export const Config: z<Config> = z.object({
  endpoint: z.string().required(),
  tokenizerId: z.string().required(),
  model: z.string().required(),
  encoder: z.string().required(),
  deployment: z.string().required(),
  deploymentManifest: z.object({
    reference: z.string().required(),
    digest: z.string().required(),
  }),
  calibrationId: z.string(),
  credentialRef: z.string(),
  providerId: z.string().default('clm-http'),
  serialization: z.string().default('clm-systemone-bb42c6c5'),
  temperature: z.number().min(0).max(100).required(),
  timeoutMs: z.natural().min(1).default(15_000),
  maxResponseBytes: z.natural().min(1).default(65_536),
})

/**

 * Resolve defaults and validate a direct-construction configuration.

 * @param config Candidate adapter config.

 * @returns Complete provider config.

 */
export function resolveConfig(config: Config): ClmHttpConfig {
  if (!Number.isFinite(config.temperature) || config.temperature <= 0 || config.temperature > 100) {
    throw new Error('operation-clm: temperature must be finite within (0, 100]')
  }
  if (config.credentialRef !== undefined) credentialRef(config.credentialRef)
  return {
    endpoint: config.endpoint,
    tokenizerId: config.tokenizerId,
    model: config.model,
    encoder: config.encoder,
    deployment: config.deployment,
    ...(config.deploymentManifest === undefined ? {} : { deploymentManifest: config.deploymentManifest }),
    ...(config.calibrationId === undefined ? {} : { calibrationId: config.calibrationId }),
    ...(config.credentialRef === undefined ? {} : { credentialRef: config.credentialRef }),
    providerId: config.providerId ?? 'clm-http',
    serialization: config.serialization ?? 'clm-systemone-bb42c6c5',
    temperature: config.temperature,
    timeoutMs: config.timeoutMs ?? 15_000,
    maxResponseBytes: config.maxResponseBytes ?? 65_536,
  }
}

/**

 * Register one drainable CLM provider against the operation judgment service.

 * @param ctx Composition context.

 * @param config CLM endpoint, local identity, tokenizer, and bounds.

 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const tokenizer = ctx.operations.judgments.requireTokenizer(resolved.tokenizerId)
  const credential = resolved.credentialRef
  const resolveCredential = credential === undefined
    ? undefined
    : async () => (await ctx.get('credentials')?.resolve(credentialRef(credential)))?.value
  const provider = new ClmHttpProvider(resolved, tokenizer, undefined, resolveCredential)
  ctx.effect(() => {
    const unregister = ctx.operations.registerJudgmentProvider(provider)
    return async () => {
      unregister()
      await provider.dispose()
    }
  }, 'operation-clm.registerProvider()')
}
