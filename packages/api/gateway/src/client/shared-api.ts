/** Remote values and declarations shared by browser and portable Client entries. */
export { readHostCapabilities } from './host-capabilities.ts'
export type { RemoteCapabilityRequirement, RemoteClientAdmission } from './host-capabilities.ts'
export type { HostCapabilities, HostCapability } from '../capabilities-protocol.ts'

export {
  inject, isRemoteFailure, RemoteStreamCarrierError, RemoteJournalStream, RemoteStream, RemoteSnapshotStream,
} from './service.ts'
export type {
  ClientRemote, RemoteHostFacts, TypertGatewayFaultDetails,
  RemoteJournalChange, RemoteJournalFrame, RemoteJournalStreamOptions, RemoteStreamFactory,
  RemoteStreamItem, RemoteStreamOptions, RemoteSnapshotStreamOptions,
} from './service.ts'
