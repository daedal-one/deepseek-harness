/** Normal ESM Client entry for portable Cordis compositions. */
import { apply as applyClient } from './index.ts'
import { applySessions as applySessionClient } from '@deepseek-ai/dsh-api-session-controller/client'
import { apply as applyWorkspaceClient } from '@deepseek-ai/dsh-api-workspace-controller/client'
export * from './index.ts'
export {
  createConnection, createConnectionRpc, readHostIdentity, claimDeviceEnrollment,
} from '@deepseek-ai/dsh-client-connection/client/portable'
export type {
  DeviceEnrollmentClaimOptions, ConnectionDeviceId, ConnectionDeviceCredential, ConnectionDeviceInfo,
  ConnectionDeviceEnrollment, ConnectionDeviceGrant, ConnectionOptions, ConnectionRpcOptions,
  ConnectionNetworkSource, RpcFetch, RpcStreamOpen,
  ConnectionIdentity, ConnectionHostId, ConnectionActivationId,
} from '@deepseek-ai/dsh-client-connection/client/portable'
export {
  readHostCapabilities, applyRemoteClient, createRemoteStreamMux, isRemoteFailure, RemoteStream, RemoteJournalStream,
  RemoteSnapshotStream, RemoteStreamCarrierError,
} from '@deepseek-ai/dsh-api-gateway/client/portable'
export type {
  HostCapabilities, HostCapability, RemoteCapabilityRequirement, RemoteClientAdmission, RemoteClientOptions,
  RemoteStreamMuxOptions, RemoteStreamSocket, RemoteStreamSignal,
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

export { inject as workspaceInject, ClientWorkspaceModel, WorkspaceController, WorkspaceCreateError,
  createWorkspaceStateStream } from '@deepseek-ai/dsh-api-workspace-controller/client'
export type { IWorkspaces, WorkspaceSource, WorkspaceSnapshot, WorkspaceListPhase,
  WorkspaceFollowSink, WorkspaceRemote, WorkspaceStateStream, WorkspaceStateStreamOptions,
} from '@deepseek-ai/dsh-api-workspace-controller/client'

/**
 * Install the shared Workspace projection and reconnecting follow stream for one host.
 * @param ctx - Client Cordis context with the generated Workspace Remote namespace.
 */
export const applyWorkspaces: (ctx: Parameters<typeof applyWorkspaceClient>[0]) => void = applyWorkspaceClient.bind(undefined)

export { sessionInject, SessionCreateError, SessionForkError, SessionEventStream,
  createSessionControlStream, MutableSessionEventSource, scopeOf,
} from '@deepseek-ai/dsh-api-session-controller/client'
export type { ISessions, SessionFace, SessionSnapshot, SessionListState, SessionBinding,
  SessionPlatform, SessionSelection, SessionSelectionStore, SessionClientOptions,
  SessionEventSource, SessionEventWindow, SessionEventChange, SessionEventLikeEntry,
  BeginSubmissionInput, SubmissionHandle, PendingSubmission,
} from '@deepseek-ai/dsh-api-session-controller/client'

/**
 * Install shared Session state and reconnecting streams for one host.
 * @param ctx - Client Cordis context with the generated Session Remotes.
 * @param options - platform callbacks and hydrated host-specific navigation.
 */
export const applySessions: typeof applySessionClient = applySessionClient.bind(undefined)
