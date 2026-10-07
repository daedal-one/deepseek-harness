/**
 * The shared read of OpenRouter's public model catalog: one implementation of
 * the reply parse, the raw-price conversion, the bounded TTL cache, and the
 * network boundary, consumed by both the spend report and model routing so the
 * two cannot disagree about what a model costs.
 *
 * @module @deepseek-ai/dsh-openrouter-catalog
 */

export type * from './types.ts'
export { parseModelsReply, findModelPricing, usdPerToken } from './parse.ts'
export { TtlCache, type CachedValue } from './cache.ts'
export { endpointOf, readEndpoint, readModels, type OpenRouterModelsReadResult } from './read.ts'
