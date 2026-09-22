/** Deployment-owned discovery limits; omission disables all discovery routes. */
import schema from '@deepseek-ai/schemastery'
import { MAX_DISCOVERY_CANDIDATES } from './discovery-protocol.ts'

/** Explicit local status execution and Tailscale probe policy. */
export interface HostDiscoveryConfig {
  /** Public display label, without machine paths or credentials. */
  readonly label: string
  /** Actual local Tailscale executable, resolved by the Host; no shell or wrapper arguments. */
  readonly executable: string
  /** HTTP ports already exposed by the deployment through Tailscale. */
  readonly ports: number[]
  /** Maximum address/port probes per scan. */
  readonly maxProbes: number
  /** Maximum simultaneous advertisement requests. */
  readonly concurrency: number
  /** Maximum time for the local status process. */
  readonly statusTimeoutMs: number
  /** Maximum UTF-8 status output bytes. */
  readonly maxStatusBytes: number
  /** Maximum lifetime of one advertisement request, including its body. */
  readonly probeTimeoutMs: number
  /** Maximum lifetime of the whole scan, including status acquisition. */
  readonly scanTimeoutMs: number
  /** Completed result cache lifetime, measured on a monotonic clock. */
  readonly cacheTtlMs: number
  /** Maximum advertisement response bytes, regardless of Content-Length. */
  readonly maxAdvertisementBytes: number
}
const duration = (): schema<number> => schema.natural().min(1).max(2_147_483_647).required()
/** Shared validation for Loader and direct Connection composition. */
export const HostDiscoveryConfigSchema: schema<HostDiscoveryConfig> = schema.object({
  label: schema.string().pattern(/^[^\u0000-\u001f\u007f]{1,80}$/).required(),
  executable: schema.string().pattern(/^[^\u0000\r\n]+$/).required(),
  ports: schema.array(schema.natural().min(1).max(65535)).min(1).max(8).required(),
  maxProbes: schema.natural().min(1).max(MAX_DISCOVERY_CANDIDATES).required(),
  concurrency: schema.natural().min(1).max(MAX_DISCOVERY_CANDIDATES).required(),
  statusTimeoutMs: duration(), maxStatusBytes: schema.natural().min(1).max(16 * 1024 * 1024).required(),
  probeTimeoutMs: duration(), scanTimeoutMs: duration(), cacheTtlMs: duration(),
  maxAdvertisementBytes: schema.natural().min(1).max(64 * 1024).required(),
})
