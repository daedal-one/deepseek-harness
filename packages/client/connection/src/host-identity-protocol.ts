/** Host correlation values shared by authenticated Connection carriers. */
import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Durable identity of one credential store; copying the store copies this id. */
export type ConnectionHostId = Branded<'connection-host-id'>

/** Identity of one application root, retained across Connection reloads. */
export type ConnectionActivationId = Branded<'connection-activation-id'>

/** Correlation facts only; version describes this envelope, not API compatibility. */
export interface ConnectionIdentity {
  readonly version: 1
  readonly hostId: ConnectionHostId
  readonly activationId: ConnectionActivationId
}

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)

/** Durable owner payload; signing secrets have a separate credential record. */
export const storedHostIdentitySchema = z.object({
  version: z.literal(1),
  hostId: uuid.transform(id => id as ConnectionHostId),
}).strict()

/** Exact identity response accepted at the Client wire boundary. */
export const connectionIdentitySchema = storedHostIdentitySchema.extend({
  activationId: uuid.transform(id => id as ConnectionActivationId),
}).strict()

/** Identity reads carry no arguments. */
export const connectionIdentityRequestSchema = z.object({}).strict()

/** Connection-owned endpoint shared by Host registration and portable callers. */
export const CONNECTION_IDENTITY_ENDPOINT = 'connection/identity'
