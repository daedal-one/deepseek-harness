/** Operation expectations checked against the current Host before business execution. */
import { z } from 'zod'
import { connectionIdentitySchema, type ConnectionIdentity } from '@deepseek-ai/dsh-client-connection/identity'

/** Versioned generated codec checksum; algorithm versions match by exact equality. */
export const wireFingerprintSchema = z.string().regex(/^typert-wire-v[1-9][0-9]*:[0-9a-f]{64}$/)
/** Positive safe integer authored independently of generated schemas. */
export const semanticRevisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

/** Generated expectations; native requests also bind the admitted Host activation. */
export interface RemoteCompatibility {
  readonly wireFingerprint: string
  readonly semanticRevision: number
  readonly identity?: ConnectionIdentity | undefined
}

/** Strict validation at the decoded RPC or logical-stream payload boundary. */
export const remoteCompatibilitySchema: z.ZodType<RemoteCompatibility> = z.object({
  wireFingerprint: wireFingerprintSchema,
  semanticRevision: semanticRevisionSchema,
  identity: connectionIdentitySchema.optional(),
}).strict()
