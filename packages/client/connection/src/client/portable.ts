/** Shared Connection API for native, browser, and shell-owned transports. */
export { createConnection } from './handle.ts'
export type {
  ConnectionGenerationState, ConnectionHandle, ConnectionLoop,
  ConnectionNetworkSource, ConnectionOptions, ConnectionStateSource,
} from './handle.ts'
export { createConnectionRpc } from './rpc-caller.ts'
export type { ConnectionRpcOptions, RpcFetch, RpcFetchResponse, RpcStreamOpen } from './rpc-caller.ts'
export type {
  ConnectionRecoveryConfig, ConnectionGeneration, ConnectionGenerationSource,
  ConnectionHostInfo, ConnectionSinks, ConnectionState,
} from './connection.ts'
export { RpcId, transportError } from '../rpc.ts'
export type { ClientConnectionRpc, ConnectionRpcFailure, ConnectionRpcResult } from '../rpc.ts'

export { readHostIdentity } from './host-identity.ts'
export type { ConnectionIdentity, ConnectionHostId, ConnectionActivationId } from '../host-identity-protocol.ts'
export { connectionIdentitySchema, connectionHostIdSchema } from '../host-identity-protocol.ts'

export { claimDeviceEnrollment } from './device-access.ts'
export type { DeviceEnrollmentClaimOptions } from './device-access.ts'
export type { ConnectionDeviceId, ConnectionDeviceCredential, ConnectionDeviceInfo, ConnectionDeviceEnrollment, ConnectionDeviceGrant } from '../device-protocol.ts'
export { connectionDeviceGrantSchema, connectionDeviceEnrollmentSchema, DEVICE_ACCESS_PATHS } from '../device-protocol.ts'
