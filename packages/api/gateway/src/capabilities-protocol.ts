/** Advisory dispatch metadata carried by the authenticated Gateway. */
import { z } from 'zod'
import type { ConnectionIdentity } from '@deepseek-ai/dsh-client-connection/types'
import { connectionIdentitySchema } from '@deepseek-ai/dsh-client-connection/identity'

/** Gateway-owned unary endpoint; the request is an empty object. */
export const HOST_CAPABILITIES_ENDPOINT = '$capabilities'

/** Exact empty discovery request, independent of domain Remote arguments. */
export const hostCapabilitiesRequestSchema = z.object({}).strict()

const endpoint = {
  endpoint: z.string().regex(/^[^/]+\/[^/]+$/),
  mode: z.enum(['unary', 'stream']),
}
/** One strict endpoint's current prerequisites; availability grants no authority. */
export type HostCapability = {
  readonly endpoint: string
  readonly mode: 'unary' | 'stream'
} & (
  | { readonly availability: 'available' }
  | { readonly availability: 'context-required' }
  | { readonly availability: 'unavailable'; readonly reason: 'service' | 'binding' | 'method' | 'lookup' | 'context' }
)

const capability: z.ZodType<HostCapability> = z.discriminatedUnion('availability', [
  z.object({ ...endpoint, availability: z.literal('available') }).strict(),
  z.object({ ...endpoint, availability: z.literal('context-required') }).strict(),
  z.object({ ...endpoint, availability: z.literal('unavailable'),
    reason: z.enum(['service', 'binding', 'method', 'lookup', 'context']),
  }).strict(),
])

/** Exact versioned response with unique endpoints in code-point order. */
export const hostCapabilitiesSchema: z.ZodType<HostCapabilities> = z.object({
  version: z.literal(1),
  identity: connectionIdentitySchema,
  capabilities: z.array(capability).refine(values => values.every((value, index) => {
    const next = values[index + 1]
    return next === undefined || value.endpoint < next.endpoint
  }), 'capability endpoints must be unique and sorted'),
}).strict()

/** Snapshot for one Host activation; version describes metadata, not domain schemas. */
export interface HostCapabilities {
  readonly version: 1
  readonly identity: ConnectionIdentity
  readonly capabilities: readonly HostCapability[]
}
