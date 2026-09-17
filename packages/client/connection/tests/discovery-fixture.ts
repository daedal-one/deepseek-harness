/** Fixed metadata and explicit deployment limits for isolated discovery cases. */
import { connectionIdentitySchema } from '../src/host-identity-protocol.ts'

export const discoveryIdentity = connectionIdentitySchema.parse({ version: 1,
  hostId: '26e99520-f2d3-4874-84b5-07c5ef24775d', activationId: 'f5292bdb-ebda-41ba-b473-6c587a3c1d02' })
export const discoveryConfig = {
  label: 'Test host', executable: '/missing-dsh-test-tailscale', ports: [3081], maxProbes: 8, concurrency: 2,
  statusTimeoutMs: 10_000, maxStatusBytes: 100_000, probeTimeoutMs: 1000, scanTimeoutMs: 20_000,
  cacheTtlMs: 1000, maxAdvertisementBytes: 4096,
}
export const advertisement = { version: 1 as const, identity: discoveryIdentity, label: 'Candidate' }
