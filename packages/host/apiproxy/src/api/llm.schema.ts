/**
 * llm domain zod schemas (names derived from map keys: llmProvidersRequestSchema /
 * llmProvidersValueSchema / llmModelsRequestSchema / llmModelsValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { ConfigurableProviderView, DiscoveredModelView, ProviderAuthMethodView } from './llm.ts'
import { modelCatalogFailureSchema, modelProviderGroupSchema } from './sessions.schema.ts'

/** ProviderAuthMethodView authentication option. */
export const providerAuthMethodViewSchema = z.object({
  type: z.enum(['api_key', 'oauth']),
  name: z.string().min(1),
  authenticated: z.boolean().optional(),
}) satisfies z.ZodType<Wire<ProviderAuthMethodView>>

/** ConfigurableProviderView row of llm.providers. */
export const configurableProviderViewSchema = z.object({
  provider: z.string().min(1),
  displayName: z.string().min(1),
  settingsNs: z.string(),
  settingsPath: z.array(z.string()),
  active: z.boolean(),
  declared: z.boolean().optional(),
  authMethods: z.array(providerAuthMethodViewSchema).optional(),
}) satisfies z.ZodType<Wire<ConfigurableProviderView>>

/** llm.providers request payload. */
export const llmProvidersRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'llm.providers'>>>

/** llm.providers response value. */
export const llmProvidersValueSchema = z.object({
  providers: z.array(configurableProviderViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'llm.providers'>>>

/** llm.models request payload. */
export const llmModelsRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'llm.models'>>>

/** llm.models response value. */
export const llmModelsValueSchema = z.object({
  groups: z.array(modelProviderGroupSchema),
  failures: z.array(modelCatalogFailureSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'llm.models'>>>

/** DiscoveredModelView row of llm.discoverModels. */
export const discoveredModelViewSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
}) satisfies z.ZodType<Wire<DiscoveredModelView>>

/** llm.discoverModels request payload. */
export const llmDiscoverModelsRequestSchema = z.object({
  settingsNs: z.string().min(1),
  provider: z.string().min(1).optional(),
  baseURL: z.string().min(1).optional(),
  api: z.string().min(1).optional(),
  // Write-only at the host: used for this one interrogation, never stored and
  // never returned. It does ride the client's outgoing envelope like every
  // other secret-bearing payload (`credentials.set`, `settings.update`), which
  // `subscribeEnvelopes()` observers can see — redacting that tap is a
  // configuration-plane-wide change, not this method's to make alone.
  apiKey: z.string().min(1).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'llm.discoverModels'>>>

/** llm.discoverModels response value. */
export const llmDiscoverModelsValueSchema = z.object({
  models: z.array(discoveredModelViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'llm.discoverModels'>>>

/** Provider authentication operation returned by start, status, and cancel. */
export const providerAuthOperationSchema = z.discriminatedUnion('status', [
  z.object({
    id: z.uuid(),
    provider: z.string().min(1),
    method: z.enum(['api_key', 'oauth']),
    status: z.literal('pending'),
    authorization: z.object({
      userCode: z.string().min(1),
      verificationUri: z.url(),
      intervalSeconds: z.number().positive().optional(),
      expiresInSeconds: z.number().positive().optional(),
    }).optional(),
  }),
  z.object({
    id: z.uuid(),
    provider: z.string().min(1),
    method: z.enum(['api_key', 'oauth']),
    status: z.literal('succeeded'),
  }),
  z.object({
    id: z.uuid(),
    provider: z.string().min(1),
    method: z.enum(['api_key', 'oauth']),
    status: z.literal('cancelled'),
  }),
  z.object({
    id: z.uuid(),
    provider: z.string().min(1),
    method: z.enum(['api_key', 'oauth']),
    status: z.literal('failed'),
    error: z.string(),
  }),
])

/** Shared provider/method request. */
const providerAuthRequestSchema = z.object({
  provider: z.string().min(1),
  method: z.enum(['api_key', 'oauth']),
})

/** Shared operation-id request. */
const providerAuthOperationRequestSchema = z.object({ operationId: z.uuid() })

/** llm.providerAuthState request payload. */
export const llmProviderAuthStateRequestSchema = providerAuthRequestSchema satisfies z.ZodType<Wire<RequestPayload<'llm.providerAuthState'>>>
/** llm.providerAuthState response value. */
export const llmProviderAuthStateValueSchema = z.object({ authenticated: z.boolean() }) satisfies z.ZodType<Wire<ResponseValue<'llm.providerAuthState'>>>
/** llm.startProviderAuth request payload. */
export const llmStartProviderAuthRequestSchema = providerAuthRequestSchema satisfies z.ZodType<Wire<RequestPayload<'llm.startProviderAuth'>>>
/** llm.startProviderAuth response value. */
export const llmStartProviderAuthValueSchema = z.object({ operation: providerAuthOperationSchema }) satisfies z.ZodType<Wire<ResponseValue<'llm.startProviderAuth'>>>
/** llm.providerAuthStatus request payload. */
export const llmProviderAuthStatusRequestSchema = providerAuthOperationRequestSchema satisfies z.ZodType<Wire<RequestPayload<'llm.providerAuthStatus'>>>
/** llm.providerAuthStatus response value. */
export const llmProviderAuthStatusValueSchema = z.object({ operation: providerAuthOperationSchema }) satisfies z.ZodType<Wire<ResponseValue<'llm.providerAuthStatus'>>>
/** llm.cancelProviderAuth request payload. */
export const llmCancelProviderAuthRequestSchema = providerAuthOperationRequestSchema satisfies z.ZodType<Wire<RequestPayload<'llm.cancelProviderAuth'>>>
/** llm.cancelProviderAuth response value. */
export const llmCancelProviderAuthValueSchema = z.object({ operation: providerAuthOperationSchema }) satisfies z.ZodType<Wire<ResponseValue<'llm.cancelProviderAuth'>>>
/** llm.logoutProviderAuth request payload. */
export const llmLogoutProviderAuthRequestSchema = providerAuthRequestSchema satisfies z.ZodType<Wire<RequestPayload<'llm.logoutProviderAuth'>>>
/** llm.logoutProviderAuth response value. */
export const llmLogoutProviderAuthValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'llm.logoutProviderAuth'>>>
