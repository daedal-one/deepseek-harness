/** Browser adapter for the shared per-host Connection. */
import type { Context } from '@deepseek-ai/cordis'
import { createConnection, type ConnectionNetworkSource } from './handle.ts'
import { createFixtureConnectionRpc } from './fixture.ts'
import { createWebConnectionRpc, type RpcFetch, type RpcStreamOpen } from './rpc.ts'
import { isLoopbackHostname } from '../loopback-hostname.ts'
import { resolveConnectionConfig } from '../recovery-config.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A connection generation was established. Wire-derived caches must
     * repull; long-lived streams own their own resume and baseline lifecycle.
     * @mode emit
     */
    'connection/reset'(): void
  }
}

// ---- Browser-safe protocol and shared value re-exports ----
export type {
  MessageId,
  RpcRequest, RpcResponse, RpcResult,
  ClientRequest, ServerResponse, RpcMessage,
  SessionId, SessionEvent, ContentBlock, StreamChunk,
} from './api.ts'
export {
  RpcId,
  transportError,
} from './api.ts'

// Connection loop types are public through ConnectionHandle.start; the
// controller remains package-internal.
export type {
  ConnectionRecoveryConfig,
  ConnectionGeneration,
  ConnectionGenerationSource,
  ConnectionHostInfo,
  ConnectionSinks,
  ConnectionState,
} from './connection.ts'
export type {
  ClientConnectionRpc, ConnectionRpcFailure, ConnectionRpcResult,
} from '../rpc.ts'
export type { RpcFetch } from './rpc.ts'

export type {
  ConnectionGenerationState,
  ConnectionHandle,
  ConnectionLoop,
  ConnectionStateSource,
} from './handle.ts'

/** Required services (none — this is the wire root). */
export const inject: string[] = []

/**
 * Carrier override installed on the page global before plugin boot. The served
 * web app leaves it unset and gets HTTP + WebSocket; a shell that owns a
 * different physical transport (the worker preview's postMessage tunnel)
 * provides both halves here instead of forking this plugin.
 */
export interface ClientTransportHooks {
  /** Transport for generic unary RPC channels (the Typert gateway). */
  fetch: RpcFetch
  /** Worker-local Gateway stream carrier; absent when the page uses the Gateway WebSocket. */
  openStream?: RpcStreamOpen
  /**
   * Bundle transport for the module system, present when the carrier also owns
   * bundle bytes (the worker tunnel). Absent in the served web app, whose
   * bundles load over HTTP.
   */
  loadBundle?(url: string): Promise<void>
  /**
   * The transport owner declares the page owns the Host outright: the Host
   * runs inside a worker this page spawned, so no other party can reach it and
   * the loopback stand-in for "the operator's own machine" is vacuous.
   * `ctx.connection.isLoopback` then reports the privileged surface reachable
   * regardless of the page authority. Only a shell that assembles its own
   * transport can set this; served pages never carry the global at all.
   */
  ownsHost?: boolean
}

/** Page global carrying {@link ClientTransportHooks}; absent in the served web app. */
interface ClientTransportGlobal {
  __DSH_TRANSPORT__?: ClientTransportHooks
  __DSH_CONNECTION_RECOVERY__?: unknown
}

interface BrowserNetworkTarget {
  readonly navigator?: { readonly onLine?: boolean }
  addEventListener(type: 'online' | 'offline', listener: () => void): void
  removeEventListener(type: 'online' | 'offline', listener: () => void): void
}

function browserNetwork(): ConnectionNetworkSource | undefined {
  const browser = (globalThis as { readonly window?: BrowserNetworkTarget }).window
  if (browser?.navigator?.onLine === undefined) return undefined
  return {
    getSnapshot: () => browser.navigator?.onLine !== false,
    subscribe(listener) {
      browser.addEventListener('online', listener)
      browser.addEventListener('offline', listener)
      return () => {
        browser.removeEventListener('online', listener)
        browser.removeEventListener('offline', listener)
      }
    },
  }
}

/**
 * Mount the shared Connection with browser fixture, transport, and network inputs.
 * @param ctx - client Cordis context.
 */
export function apply(ctx: Context): void {
  const pageLocation = typeof location === 'undefined' ? undefined : location
  const fixture = pageLocation !== undefined && new URLSearchParams(pageLocation.search).has('fixture')
  const transport = (globalThis as ClientTransportGlobal).__DSH_TRANSPORT__
  const recovery = resolveConnectionConfig((globalThis as ClientTransportGlobal).__DSH_CONNECTION_RECOVERY__)
  const network = browserNetwork()
  ctx.provide('connection', createConnection({
    rpc: fixture ? createFixtureConnectionRpc() : createWebConnectionRpc(transport?.fetch, transport?.openStream),
    isLoopback: transport?.ownsHost === true || pageLocation === undefined || isLoopbackHostname(pageLocation.hostname),
    recovery,
    ...network === undefined ? {} : { network },
  }))
}

export { readHostIdentity } from './host-identity.ts'
export type { ConnectionIdentity, ConnectionHostId, ConnectionActivationId } from '../host-identity-protocol.ts'
export { connectionIdentitySchema } from '../host-identity-protocol.ts'
