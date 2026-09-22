/** Page transport defaults for the shared Gateway stream carrier. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { REMOTE_STREAM_MUX_PATH } from '../stream-protocol.ts'
import { RemoteStreamMuxClient } from './stream-client.ts'

const INTERNAL_BASE = 'http://dsh.internal'

/**
 * Adapt the current page and browser crypto to the shared stream carrier.
 * @returns a carrier that selects the page host for each physical attempt.
 */
export function createBrowserRemoteStreamMux(): RemoteStreamMuxClient {
  return new RemoteStreamMuxClient({
    randomId: randomUUID,
    createSocket: () => {
      const location = (globalThis as { location?: { origin?: string } }).location
      const base = location?.origin !== undefined && location.origin !== 'null' ? location.origin : INTERNAL_BASE
      const url = new URL(REMOTE_STREAM_MUX_PATH, base)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      return new WebSocket(url.href)
    },
  })
}
