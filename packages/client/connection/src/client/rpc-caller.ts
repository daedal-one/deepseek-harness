/** Unary RPC envelopes over explicit per-host transports. */

import {
  RpcId,
  type ClientRequest,
  type RpcId as RpcIdType,
} from '../rpc.ts'
import type { ClientConnectionRpc, ConnectionRpcResult } from '../rpc.ts'
const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/

/** Transport this caller posts through; same signature as the global `fetch`. */
export type RpcFetch = (input: URL, init: RequestInit) => Promise<Response>

/** Transport-owned opener for decoded Gateway Remote streams. */
export type RpcStreamOpen = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) => AsyncIterable<unknown>

/** Explicit transport inputs for one Host's RPC calls. */
export interface ConnectionRpcOptions {
  /** Base authority used to resolve absolute RPC channel paths. */
  readonly baseUrl: string
  /** Host-authenticated Fetch implementation; owns credentials and networking. */
  readonly fetch: RpcFetch
  /** Mint a new correlation id for each request. */
  readonly randomId: () => RpcIdType
  /** Optional carrier for decoded Gateway streams. */
  readonly openStream?: RpcStreamOpen
}

/**
 * Create an RPC caller without reading browser, crypto, or transport globals.
 * Requests are sent once; a rejected transport leaves command acceptance unknown.
 * @param options - Host authority, transport, and correlation-id source.
 * @returns caller validating targets, response envelopes, and correlation without retrying mutations.
 */
export function createConnectionRpc(options: ConnectionRpcOptions): ClientConnectionRpc {
  const openStream = options.openStream
  return {
    async call(channel, endpoint, payload, signal) {
      assertTarget(channel, endpoint)
      const rpcId = options.randomId()
      const message: ClientRequest = {
        type: 'client-request',
        rpcId,
        method: endpoint,
        payload,
      }
      const response = await options.fetch(
        new URL(`${channel}/${endpoint}`, options.baseUrl),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(message),
          ...signal === undefined ? {} : { signal },
        },
      )
      if (!response.ok) {
        throw new Error(`transport failure for ${channel}/${endpoint}: HTTP ${response.status}`)
      }
      const full = parseConnectionResponse(await response.json())
      if (full.rpcId !== rpcId) {
        throw new Error(`rpcId mismatch for ${endpoint}: sent ${rpcId}, got ${full.rpcId}`)
      }
      return full.result
    },
    ...openStream === undefined ? {} : {
      open(channel, endpoint, payload, signal) {
        assertTarget(channel, endpoint)
        if (channel !== '/api') {
          throw new Error(`connection: direct streams require the /api channel, got ${JSON.stringify(channel)}`)
        }
        return openStream(endpoint, payload, signal)
      },
    },
  }
}

function parseConnectionResponse(value: unknown): {
  readonly rpcId: RpcIdType
  readonly result: ConnectionRpcResult<unknown>
} {
  if (!isRecord(value) || value.type !== 'server-response' || typeof value.rpcId !== 'string') {
    throw new TypeError('connection: invalid server-response envelope')
  }
  const result = value.result
  if (!isRecord(result)) throw new TypeError('connection: invalid server-response result')
  if (result.ok === true) {
    return {
      rpcId: RpcId(value.rpcId),
      result: { ok: true, value: result.value },
    }
  }
  if (result.ok !== false || !isRecord(result.error)) {
    throw new TypeError('connection: invalid server-response result')
  }
  const error = result.error
  if (typeof error.code !== 'string' || typeof error.message !== 'string' || !isRecord(error.details)) {
    throw new TypeError('connection: invalid server-response failure')
  }
  return {
    rpcId: RpcId(value.rpcId),
    result: {
      ok: false,
      error: { code: error.code, message: error.message, details: error.details },
    },
  }
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertTarget(channel: string, endpoint: string): void {
  const segments = endpoint.split('/')
  if (!CHANNEL_PATTERN.test(channel)
    || segments.some(segment =>
      segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
    throw new Error(`connection: invalid RPC target ${JSON.stringify(`${channel}/${endpoint}`)}`)
  }
}
