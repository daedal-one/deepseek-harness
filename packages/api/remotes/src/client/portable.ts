/** Normal ESM Client entry for portable Cordis compositions. */
import { apply as applyClient } from './index.ts'
export * from './index.ts'
export { createConnection, createConnectionRpc } from '@deepseek-ai/dsh-client-connection/client/portable'
export type {
  ConnectionOptions, ConnectionRpcOptions, ConnectionNetworkSource, RpcFetch, RpcStreamOpen,
} from '@deepseek-ai/dsh-client-connection/client/portable'
export {
  applyRemoteClient, createRemoteStreamMux, isRemoteFailure, RemoteStream, RemoteJournalStream,
  RemoteSnapshotStream, RemoteStreamCarrierError,
} from '@deepseek-ai/dsh-api-gateway/client/portable'
export type {
  RemoteClientOptions, RemoteStreamMuxOptions, RemoteStreamSocket, RemoteStreamSignal,
  RemoteStreamOptions, RemoteStreamItem, RemoteSnapshotStreamOptions,
  RemoteJournalChange, RemoteJournalFrame, RemoteJournalStreamOptions, RemoteStreamFactory,
} from '@deepseek-ai/dsh-api-gateway/client/portable'
export { apply as applyRegistry, inject as registryInject } from '@deepseek-ai/dsh-typert-registry/client/portable'

/**
 * Install the Client plugin through a callback Cordis invokes as a function.
 * Binding prevents Cordis from treating a transpiled function as a constructor.
 * @param ctx - Client Cordis root with this plugin's injected services.
 * @returns disposer once every generated namespace is ready.
 */
export const apply: (ctx: Parameters<typeof applyClient>[0]) => Promise<() => Promise<void>> = applyClient.bind(undefined)
