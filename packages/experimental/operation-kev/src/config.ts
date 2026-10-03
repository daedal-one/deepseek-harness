/**
 * Explicit immutable deployment declarations for the private Kev decision provider.
 * @module @deepseek-ai/dsh-experimental-operation-kev/config
 */

import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import z from '@deepseek-ai/schemastery'
import type { OperationDeploymentManifestVerification } from '@deepseek-ai/dsh-experimental-operation'
import { LocalHttpClient, MAX_TIMER_DELAY_MS, type LocalHttpConfig } from '@deepseek-ai/dsh-experimental-operation-clm/local-http'

/** Reviewed service limits included in the deployment/configuration identity. */
export interface KevServiceCaps {
  /** Maximum complete official encoder input; exceeding this ceiling rejects rather than truncates. */
  readonly maxInputTokens: number
  /** One past the largest actual tokenizer id, including added and special tokens. */
  readonly vocabSize: number
  /** Maximum complete choice candidates accepted by one service request. */
  readonly maxCandidates: number
  /** Service ceiling in bytes for the complete incoming HTTP request body. */
  readonly maxRequestBytes: number
  /** Service ceiling in bytes for the complete outgoing HTTP response body. */
  readonly maxResponseBytes: number
  /** Maximum waiting requests admitted behind the single supervised worker. */
  readonly maxQueueSize: number
  /** Manifest queue-wait plus execution budget in milliseconds, independent of the client's HTTP deadline. */
  readonly requestTimeoutMs: number
  /** Maximum worker execution time in milliseconds before termination and join are required. */
  readonly executionTimeoutMs: number
}

/** Required provider configuration; readiness never supplies a calibration declaration. */
export interface Config extends LocalHttpConfig {
  /** Required service authorization reference, resolved afresh per HTTP request. */
  readonly credentialRef: string
  /** Local provider identifier, independent of the wire model route. */
  readonly providerId: string
  /** Immutable model artifact identity, not a route alias. */
  readonly model: string
  /** Exact official System One model route accepted by the local service. */
  readonly wireModel: string
  /** Immutable encoder identity binding the deployed base and adapter artifacts. */
  readonly encoder: string
  /** Immutable tokenizer and special-token recipe identity echoed by preparation. */
  readonly tokenizerId: string
  /** Pinned official single-question encoding and System One serialization recipe. */
  readonly serialization: 'kev-90512f1c-systemone-choice-v1'
  /** SHA-256 of exact serving-manifest bytes; must equal deploymentManifest.digest. */
  readonly deployment: string
  /** Operator-reviewed reference to that same serving manifest, not a separate review artifact. */
  readonly deploymentManifest: OperationDeploymentManifestVerification
  /** Supported CPU model precision; other precision deployments are not implemented. */
  readonly dtype: 'float32'
  /** Reviewed service limits that must exactly match the manifest-owned response identity. */
  readonly serviceCaps: KevServiceCaps
  /** Separate operator calibration declaration about this deployment; this provider performs no model qualification. */
  readonly calibrationId?: string
}

/** Loader schema with explicit deployment and local admission limits, without defaults. */
export const Config: z<Config> = z.object({
  endpoint: z.string().required(),
  credentialRef: z.string().required(),
  providerId: z.string().required(),
  model: z.string().required(),
  wireModel: z.string().required(),
  encoder: z.string().required(),
  tokenizerId: z.string().required(),
  serialization: z.const('kev-90512f1c-systemone-choice-v1').required(),
  deployment: z.string().required(),
  deploymentManifest: z.object({ reference: z.string().required(), digest: z.string().required() }).required(),
  dtype: z.const('float32').required(),
  serviceCaps: z.object({
    maxInputTokens: z.natural().min(1).required(),
    vocabSize: z.natural().min(1).required(),
    maxCandidates: z.natural().min(1).required(),
    maxRequestBytes: z.natural().min(1).required(),
    maxResponseBytes: z.natural().min(1).required(),
    maxQueueSize: z.natural().required(),
    requestTimeoutMs: z.natural().min(1).required(),
    executionTimeoutMs: z.natural().min(1).required(),
  }).required(),
  calibrationId: z.string(),
  timeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).required(),
  maxRequestBytes: z.natural().min(1).required(),
  maxResponseBytes: z.natural().min(1).required(),
  maxConcurrentRequests: z.natural().min(1).required(),
})

/**
 * Validate and detach a configuration without filling operator-owned identities or limits.
 * @param candidate Explicit deployment configuration.
 * @returns Deeply frozen configuration with normalized HTTP origin.
 */
export function resolveConfig(candidate: Config): Config {
  let config: Config
  try { config = Config(candidate) } catch { throw new Error('operation-kev: invalid explicit configuration') }
  const fields = [
    'endpoint', 'credentialRef', 'providerId', 'model', 'wireModel', 'encoder', 'tokenizerId', 'serialization',
    'deployment', 'deploymentManifest', 'dtype', 'serviceCaps', 'calibrationId',
    'timeoutMs', 'maxRequestBytes', 'maxResponseBytes', 'maxConcurrentRequests',
  ]
  if (Object.keys(config).some(key => !fields.includes(key))
    || Object.keys(config.deploymentManifest).some(key => key !== 'reference' && key !== 'digest')) {
    throw new Error('operation-kev: unsupported configuration fields')
  }
  for (const key of ['providerId', 'model', 'wireModel', 'encoder', 'tokenizerId', 'serialization', 'deployment', 'dtype'] as const) {
    if (config[key].length === 0) throw new Error(`operation-kev: ${key} must be non-empty`)
  }
  if (!config.deploymentManifest.reference || !/^sha256:[0-9a-f]{64}$/u.test(config.deploymentManifest.digest)) {
    throw new Error('operation-kev: an explicit manifest reference and SHA-256 digest are required')
  }
  if (config.deployment !== config.deploymentManifest.digest) throw new Error('operation-kev: deployment must equal the serving manifest digest')
  if (config.calibrationId !== undefined && config.calibrationId.length === 0) throw new Error('operation-kev: calibrationId must be non-empty when supplied')
  const caps = ['maxInputTokens', 'vocabSize', 'maxCandidates', 'maxRequestBytes', 'maxResponseBytes',
    'maxQueueSize', 'requestTimeoutMs', 'executionTimeoutMs']
  for (const [key, value] of Object.entries(config.serviceCaps)) {
    if (!caps.includes(key)) throw new Error('operation-kev: unsupported service cap')
    if (!Number.isSafeInteger(value) || value < (key === 'maxQueueSize' ? 0 : 1)) throw new Error('operation-kev: service caps must be bounded safe integers')
  }
  try { credentialRef(config.credentialRef) } catch { throw new Error('operation-kev: invalid credential reference') }
  // Construction validates transport settings without acquiring sockets or resolving secrets.
  void new LocalHttpClient(config)
  return deepFreeze(structuredClone(Object.assign({}, config, { endpoint: new URL(config.endpoint).origin })))
}
