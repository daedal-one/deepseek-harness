/** Browser plugin adapter for the shared typed Remote service. */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { installRemoteClient } from './service.ts'
import { createBrowserRemoteStreamMux } from './stream-client-browser.ts'

export {
  inject, isRemoteFailure, RemoteStreamCarrierError, RemoteJournalStream, RemoteStream, RemoteSnapshotStream,
} from './service.ts'
export type {
  ClientRemote, RemoteHostFacts, TypertGatewayFaultDetails,
  RemoteJournalChange, RemoteJournalFrame, RemoteJournalStreamOptions, RemoteStreamFactory,
  RemoteStreamItem, RemoteStreamOptions, RemoteSnapshotStreamOptions,
} from './service.ts'

/**
 * Install the shared Remote service using browser socket and crypto inputs.
 * @param ctx - Client Cordis root.
 */
export function apply(ctx: Context): void {
  installRemoteClient(ctx, createBrowserRemoteStreamMux(), randomUUID())
}
