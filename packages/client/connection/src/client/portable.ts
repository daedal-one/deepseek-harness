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

export * from './device-api.ts'

export { discoverHosts } from './host-discovery.ts'
export { hostDiscoveryResultSchema, hostDiscoveryCandidateSchema, HOST_DISCOVERY_ENDPOINT } from '../discovery-protocol.ts'
export type { HostAdvertisement, HostDiscoveryCandidate, HostDiscoveryResult, TailnetOrigin } from '../discovery-protocol.ts'
