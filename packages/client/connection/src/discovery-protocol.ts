/** Public candidate metadata and authenticated Host-assisted discovery responses. */
import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { connectionIdentitySchema } from './host-identity-protocol.ts'

/** Canonical HTTP origin on a numeric Tailscale address; never an authorization fact. */
export type TailnetOrigin = Branded<'connection-tailnet-origin'>

/** Exact opt-in public advertisement path. */
export const HOST_ADVERTISEMENT_PATH = '/api/connection/discovery/advertisement'
/** Authenticated Connection endpoint; discovery remains optional for Session clients. */
export const HOST_DISCOVERY_ENDPOINT = 'connection/discovery'
/** Version-one wire bound, independent of lower deployment scan limits. */
export const MAX_DISCOVERY_CANDIDATES = 256

/**
 * Classify canonical numeric addresses without DNS or URL normalization aliases.
 * @param address - raw Tailscale status address, without brackets or a zone id.
 * @returns whether the address belongs to Tailscale's IPv4 or IPv6 allocation.
 */
export function isTailnetAddress(address: string): boolean {
  if (
    /^100\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-5])\.(?:0|[1-9]\d?|1\d\d|2[0-4]\d|25[0-5])\.(?:0|[1-9]\d?|1\d\d|2[0-4]\d|25[0-5])$/.test(address)
  ) {
    const second = Number(address.split('.')[1])
    return second >= 64 && second <= 127
  }
  if (!address.startsWith('fd7a:115c:a1e0:') || !/^[0-9a-f:]+$/.test(address)) return false
  try { return new URL(`http://[${address}]`).hostname === `[${address}]` }
  catch { return false } // Invalid IPv6 literals are not probe targets.
}

/** Validate probe-derived origins without accepting peer-supplied paths or credentials. */
export const tailnetOriginSchema = z.string().refine((value) => {
  let url: URL
  try { url = new URL(value) }
  catch { return false } // Wire values need not be syntactically valid URLs.
  const address = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname
  return url.protocol === 'http:' && url.origin === value && isTailnetAddress(address)
}).transform(value => value as TailnetOrigin)

/** Anonymous correlation claims only; no URLs, grants, or enrollment challenges. */
export const hostAdvertisementSchema = z.object({
  version: z.literal(1), identity: connectionIdentitySchema,
  label: z.string().trim().min(1).max(80).refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
}).strict()
/** Complete metadata supplied by an opt-in Host. */
export type HostAdvertisement = z.infer<typeof hostAdvertisementSchema>

/** A probe-derived address with untrusted advertised identity and display label. */
export const hostDiscoveryCandidateSchema = hostAdvertisementSchema.extend({ origin: tailnetOriginSchema }).strict()
/** Candidate metadata never authorizes a device or transfers another Host's grant. */
export type HostDiscoveryCandidate = z.infer<typeof hostDiscoveryCandidateSchema>

/** Exact empty request: callers cannot supply scan targets or credentials. */
export const hostDiscoveryRequestSchema = z.object({}).strict()
/** Version-one response, including its authenticated assisting Host. */
export const hostDiscoveryResultSchema = z.object({
  version: z.literal(1), host: connectionIdentitySchema,
  status: z.enum(['ready', 'tailscale-unavailable', 'tailscale-disconnected', 'scan-failed']),
  truncated: z.boolean(), candidates: z.array(hostDiscoveryCandidateSchema).max(MAX_DISCOVERY_CANDIDATES),
}).strict().refine(result => (result.status === 'ready' || result.candidates.length === 0)
  && new Set(result.candidates.map(candidate => candidate.identity.hostId)).size === result.candidates.length)
/** Bounded scan result; absence does not prove that no other Host exists. */
export type HostDiscoveryResult = z.infer<typeof hostDiscoveryResultSchema>
