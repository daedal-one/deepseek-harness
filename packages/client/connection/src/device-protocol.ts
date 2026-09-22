/** Versioned device enrollment payloads shared by Connection and portable clients. */
import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { storedHostIdentitySchema, type ConnectionHostId } from './host-identity-protocol.ts'

/** Identity of one independently revocable device grant. */
export type ConnectionDeviceId = Branded<'connection-device-id'>
/** Device bearer secret returned only by a successful enrollment claim. */
export type ConnectionDeviceCredential = Branded<'connection-device-credential'>

/** Exact Connection-owned HTTP routes; enrollment secrets travel only in JSON bodies. */
export const DEVICE_ACCESS_PATHS = {
  enroll: '/api/connection/devices/enroll',
  claim: '/api/connection/devices/claim',
  list: '/api/connection/devices',
  revoke: '/api/connection/devices/revoke',
} as const

/** Security budget for the unauthenticated claim body, including bounded device metadata. */
export const DEVICE_CLAIM_MAX_BYTES = 2048

/** Validate an opaque device identity at wire and persistence boundaries. */
export const connectionDeviceIdSchema = z.string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  .transform(value => value as ConnectionDeviceId)
/** Fixed 256-bit token encoding; equality checks still require the exact minted token. */
export const enrollmentChallengeSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
/** A credential is never accepted from a URL or a cookie. */
export const deviceCredentialSchema = z.string()
  .regex(/^dsh-device-v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/)
  .refine(value => connectionDeviceIdSchema.safeParse(value.split('.')[1]).success)
  .transform(value => value as ConnectionDeviceCredential)

/** Public device metadata; neither token digests nor provider credentials are exposed. */
export interface ConnectionDeviceInfo {
  readonly deviceId: ConnectionDeviceId
  readonly label: string
  readonly createdAt: number
}
/** Bounded owner-visible metadata and persisted grant fields. */
export const connectionDeviceInfoSchema: z.ZodType<ConnectionDeviceInfo> = z.object({
  deviceId: connectionDeviceIdSchema,
  label: z.string().trim().min(1).max(80),
  createdAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict()

/** Short-lived, single-use enrollment issued to an authenticated owner. */
export interface ConnectionDeviceEnrollment {
  readonly version: 1
  readonly hostId: ConnectionHostId
  readonly challenge: string
  readonly expiresAt: number
}
/** Validate owner-issued enrollment metadata before application QR consumption. */
export const connectionDeviceEnrollmentSchema: z.ZodType<ConnectionDeviceEnrollment> = z.object({
  version: z.literal(1),
  hostId: storedHostIdentitySchema.shape.hostId,
  challenge: enrollmentChallengeSchema,
  expiresAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict()
/** Successful claim, persisted before its secret is returned. */
export interface ConnectionDeviceGrant {
  readonly version: 1
  readonly hostId: ConnectionHostId
  readonly device: ConnectionDeviceInfo
  readonly credential: ConnectionDeviceCredential
}

/** Exact claim body; the expected Host prevents enrollment against another host. */
export const deviceClaimSchema = z.object({
  hostId: storedHostIdentitySchema.shape.hostId,
  challenge: enrollmentChallengeSchema,
  label: z.string().trim().min(1).max(80),
}).strict()
/** Exact owner revocation body. */
export const deviceRevokeSchema = z.object({ deviceId: connectionDeviceIdSchema }).strict()
/** Owner enrollment creation carries no options or delegated authority. */
export const deviceEnrollSchema = z.object({}).strict()
/** Validate the one-time credential result before a native caller stores it. */
export const connectionDeviceGrantSchema: z.ZodType<ConnectionDeviceGrant> = z.object({
  version: z.literal(1),
  hostId: storedHostIdentitySchema.shape.hostId,
  device: connectionDeviceInfoSchema,
  credential: deviceCredentialSchema,
}).strict().refine(value => value.credential.split('.')[1] === value.device.deviceId)
