/** Normal ESM entry for per-host Gateway stream transports. */
import { REMOTE_STREAM_MUX_PATH } from '../stream-protocol.ts'
import { RemoteStreamMuxClient, type RemoteStreamSocket } from './stream-client.ts'

export { RemoteStreamCarrierError } from './stream-client.ts'
export type { RemoteStreamSignal, RemoteStreamSocket } from './stream-client.ts'

/** Explicit host and platform inputs for a multiplexed Remote stream carrier. */
export interface RemoteStreamMuxOptions {
  /** HTTP(S) host origin; the Gateway route is absolute within this origin. */
  readonly baseUrl: string
  /**
   * Create an authenticated socket for the selected host. Credential handling belongs to the adapter.
   * @param url - complete ws(s) Gateway URL.
   * @returns a fresh socket whose lifecycle events begin after this call returns.
   */
  createSocket(url: string): RemoteStreamSocket
  /** @returns a unique identity for each logical stream, including after reconnect. */
  randomId(): string
}

/**
 * Create one host's stream carrier without browser globals. Start/reconnect belongs to Connection;
 * streams never replay themselves. Close permanently releases this instance's transport.
 * @param options - host URL, authenticated socket adapter and correlation identity generator.
 * @returns an independent multiplexed carrier; invalid host URLs throw before any socket is opened.
 */
export function createRemoteStreamMux(options: RemoteStreamMuxOptions): RemoteStreamMuxClient {
  const url = new URL(REMOTE_STREAM_MUX_PATH, options.baseUrl)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('api gateway: Remote stream host must use HTTP or HTTPS')
  }
  if (url.username !== '' || url.password !== '') {
    throw new TypeError('api gateway: Remote stream credentials belong in the socket adapter')
  }
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return new RemoteStreamMuxClient({
    createSocket: () => options.createSocket(url.href),
    randomId: () => options.randomId(),
  })
}
