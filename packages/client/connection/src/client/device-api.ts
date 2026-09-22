/** Host identity and device access exports shared by both Client entries. */
export { readHostIdentity } from './host-identity.ts'
export type { ConnectionIdentity, ConnectionHostId, ConnectionActivationId } from '../host-identity-protocol.ts'
export { connectionIdentitySchema, connectionHostIdSchema } from '../host-identity-protocol.ts'

export { claimDeviceEnrollment } from './device-access.ts'
export type { DeviceEnrollmentClaimOptions } from './device-access.ts'
export type { ConnectionDeviceId, ConnectionDeviceCredential, ConnectionDeviceInfo, ConnectionDeviceEnrollment, ConnectionDeviceGrant } from '../device-protocol.ts'
export { connectionDeviceGrantSchema, connectionDeviceEnrollmentSchema, DEVICE_ACCESS_PATHS } from '../device-protocol.ts'
