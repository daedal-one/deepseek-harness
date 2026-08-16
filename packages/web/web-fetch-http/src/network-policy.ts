/**
 * Connect-time destination validation for the anonymous HTTP(S) fetch provider.
 * Hostnames are resolved and validated inside the socket lookup operation so the
 * connector can use only the exact address records that passed policy.
 *
 * @module @deepseek-ai/dsh-web-fetch-http/network-policy
 */

import { lookup as nodeLookup, type LookupAddress, type LookupOptions } from 'node:dns'
import { isIP, type LookupFunction } from 'node:net'
import { WebError } from '@deepseek-ai/dsh-web'
import ipaddr from 'ipaddr.js'

/**
 * Callback form used by the OS resolver when every address is requested.
 *
 * @param hostname - The DNS hostname to resolve.
 * @param options - Lookup options requiring the complete address set.
 * @param callback - Receives the resolver error or every address record.
 */
export type ResolveAll = (
  hostname: string,
  options: LookupOptions & { all: true },
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void

const defaultResolveAll: ResolveAll = nodeLookup

// ipaddr.js supplies the primary special-range classification. These explicit
// or intentionally broad reservations keep non-public space fail-closed when
// the pinned dependency does not name a range separately.
const additionalNonPublicIpv4 = [
  ipaddr.IPv4.parseCIDR('198.18.0.0/15'),
] as const

const additionalNonPublicIpv6 = [
  ipaddr.IPv6.parseCIDR('64:ff9b:1::/48'),
  ipaddr.IPv6.parseCIDR('100::/64'),
  ipaddr.IPv6.parseCIDR('2001::/23'),
  ipaddr.IPv6.parseCIDR('3fff::/20'),
] as const

const ipv6GlobalUnicast = ipaddr.IPv6.parseCIDR('2000::/3')

/**
 * Return an IP literal without URL brackets.
 *
 * @param hostname - A URL hostname, possibly a bracketed IPv6 literal.
 * @returns The normalized literal, or `undefined` for a DNS hostname.
 */
export function ipLiteral(hostname: string): string | undefined {
  const candidate = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  return isIP(candidate) === 0 ? undefined : candidate
}

/**
 * Reject an address unless it is globally routable unicast. IPv4-mapped IPv6
 * addresses inherit the embedded IPv4 address's classification.
 *
 * @param address - An IPv4 or IPv6 address returned by URL parsing or DNS.
 */
export function assertPublicAddress(address: string): void {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6
  try {
    parsed = ipaddr.parse(address)
  } catch (error: unknown) {
    throw new WebError('destination resolved to an invalid address', 'WEB_BLOCKED_URL', { cause: error })
  }

  if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) {
    parsed = parsed.toIPv4Address()
  }
  const additionalBlock = parsed instanceof ipaddr.IPv4
    ? additionalNonPublicIpv4.some(cidr => parsed.match(cidr))
    : !parsed.match(ipv6GlobalUnicast) || additionalNonPublicIpv6.some(cidr => parsed.match(cidr))
  if (parsed.range() !== 'unicast' || additionalBlock) {
    throw new WebError('destination is not a public network address', 'WEB_BLOCKED_URL')
  }
}

/**
 * Reject a literal non-public destination before transport can bypass lookup.
 *
 * @param hostname - A URL hostname, possibly a bracketed IPv6 literal.
 */
export function assertPublicLiteral(hostname: string): void {
  const literal = ipLiteral(hostname)
  if (literal !== undefined) assertPublicAddress(literal)
}

/**
 * Build the lookup function installed directly on Undici's connector. Every OS
 * result is validated before the same records are returned to `net.connect`.
 *
 * @param resolveAll - The OS resolver; injectable only by source-level tests.
 * @returns A Node socket lookup function.
 */
export function createValidatedLookup(resolveAll: ResolveAll = defaultResolveAll): LookupFunction {
  return (hostname, options, callback) => {
    resolveAll(hostname, { family: 0, hints: options.hints, all: true, order: 'verbatim' }, (error, addresses) => {
      if (error !== null) {
        callback(error, '', 0)
        return
      }
      if (addresses.length === 0) {
        const noAddress = new Error(`no addresses found for ${hostname}`) as NodeJS.ErrnoException
        noAddress.code = 'ENOTFOUND'
        callback(noAddress, '', 0)
        return
      }
      try {
        for (const record of addresses) assertPublicAddress(record.address)
      } catch (validationError: unknown) {
        callback(asLookupError(validationError), '', 0)
        return
      }

      if (options.all === true) {
        callback(null, addresses)
      } else {
        const first = addresses[0]
        if (first === undefined) {
          callback(Object.assign(new Error(`no addresses found for ${hostname}`), { code: 'ENOTFOUND' }), '', 0)
          return
        }
        callback(null, first.address, first.family)
      }
    })
  }
}

/** Preserve package-owned WebError identity across Node's lookup callback type. */
function asLookupError(error: unknown): NodeJS.ErrnoException {
  return error instanceof Error ? error : new Error(String(error))
}
