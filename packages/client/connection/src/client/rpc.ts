/** Browser defaults for the shared unary RPC caller. */
import { RpcId, type ClientConnectionRpc } from '../rpc.ts'
import { randomUuid } from './random-uuid.ts'
import { createConnectionRpc, type RpcFetch, type RpcStreamOpen } from './rpc-caller.ts'

export type { RpcFetch, RpcFetchResponse, RpcStreamOpen } from './rpc-caller.ts'

const INTERNAL_BASE = 'http://dsh.internal'

/**
 * Create the browser-backed generic RPC caller.
 * @param doFetch - transport override; defaults to the page's global fetch.
 * @param openStream - optional shell-owned Gateway stream carrier.
 * @returns caller that owns request correlation and response-envelope validation.
 */
export function createWebConnectionRpc(doFetch?: RpcFetch, openStream?: RpcStreamOpen): ClientConnectionRpc {
  return createConnectionRpc({
    get baseUrl() { return resolveBase() },
    fetch: doFetch ?? ((input, init) => globalThis.fetch(input, init)),
    randomId: () => RpcId(randomUuid()),
    ...openStream === undefined ? {} : { openStream },
  })
}

function resolveBase(): string {
  const location = (globalThis as { location?: { origin?: string } }).location
  return location?.origin !== undefined && location.origin !== 'null' ? location.origin : INTERNAL_BASE
}
