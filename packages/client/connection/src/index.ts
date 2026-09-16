/** Host HTTP bridge for browser-client RPC. */
import type { ConnectionRequestAuthorization } from './rpc.ts'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-credentials'
// Activates the webServer Context merge used below.
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { API_PATH } from './api-path.ts'
import { bridge, DEFAULT_MAX_REQUEST_BODY_BYTES } from './http-bridge.ts'
import { DeviceAccess, DeviceAccessConfigSchema, DEVICE_ACCESS_KEY, type DeviceAccessConfig } from './device-access.ts'
import { DEVICE_ACCESS_PATHS, DEVICE_CLAIM_MAX_BYTES } from './device-protocol.ts'
import { assertTrustedAuthority, isTrustedApiRequest } from './api-request-trust.ts'
import { BrowserAuth } from './browser-auth.ts'
import { createHostIdentity } from './host-identity.ts'
import { CONNECTION_IDENTITY_ENDPOINT, connectionIdentityRequestSchema } from './host-identity-protocol.ts'
import { HostConnectionService } from './rpc-host.ts'
import { ConnectionRecoveryConfigSchema, resolveConnectionConfig, type ConnectionRecoveryConfig } from './recovery-config.ts'

export type {
  ConnectionFetchMethod,
  ConnectionFetchHandler,
  ConnectionFetchRoute,
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  ConnectionRpcEndpointMatcher,
  ConnectionRpcFailure,
  ConnectionRpcHandler,
  ConnectionRequestRejection,
  ConnectionRequestAuthorization, ConnectionRequestLease,
  ConnectionRpcResult,
  ConnectionRequestBodyMode,
  ConnectionTrustRequest,
  ClientRequest,
  HostConnectionHandle,
  HostConnectionFetch,
  HostConnectionRpc,
  RpcMessage,
  ServerResponse,
} from './rpc.ts'
export { RpcId, transportError } from './rpc.ts'
export {
  clientRequestSchema,
  rpcErrorSchema,
  rpcIdSchema,
  rpcMessageSchema,
  rpcResultSchema,
  serverResponseSchema,
} from './rpc-schema.ts'
export { HostConnectionService } from './rpc-host.ts'

export { API_PATH } from './api-path.ts'

/** Stable Cordis plugin name. */
export const name = 'client-connection'

/** Headroom for RPC JSON fields around aggregate base64 image payloads. */
const REQUEST_ENVELOPE_HEADROOM_BYTES = 1024 * 1024

function assertImageBodyCapacity(ctx: Context, maxRequestBodyBytes: number): void {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) return
  const requiredImageBodyBytes = Math.ceil(
    attachments.imageLimits.maxMessageImageBytes * 4 / 3,
  ) + REQUEST_ENVELOPE_HEADROOM_BYTES
  if (maxRequestBodyBytes < requiredImageBodyBytes) {
    throw new Error(
      `client-connection maxRequestBodyBytes (${String(maxRequestBodyBytes)}) must be at least `
      + `${String(requiredImageBodyBytes)} for the configured aggregate image limit`,
    )
  }
}

/** Services required before providing Connection. */
export const inject = ['credentials']

/** Browser authentication, request limits, and connection recovery configuration. */
export interface ConnectionConfig {
  /** Browser recovery timing, injected into each served page. */
  recovery?: ConnectionRecoveryConfig
  /**
   * Authorities this deployment serves beyond loopback: exact `host:port`, or
   * port-less `host` matching any port. The /api trust fence refuses any
   * request whose Host is neither loopback nor listed here, so a
   * non-loopback (`0.0.0.0`) deployment must declare the names it is reached
   * by; the Web runtime derives LAN IP literals from an active all-interface
   * bind. An entry that is not a bare, canonical authority fails plugin load.
   */
  trustedHosts?: string[]
  /** Absolute browser-session lifetime in days. Default: 30. */
  cookieMaxAgeDays?: number
  /** Maximum buffered JSON body for every `/api` request. Default: 300 MiB. */
  maxRequestBodyBytes?: number
  /** Explicit enrollment limits; omitted configurations disable device access. */
  deviceAccess?: DeviceAccessConfig
}

export const Config: z<ConnectionConfig> = z.object({
  recovery: ConnectionRecoveryConfigSchema.default({}),
  // A union leaves omission disabled instead of applying the object schema's empty default.
  deviceAccess: z.union([DeviceAccessConfigSchema]),
  trustedHosts: z.array(String).default([]),
  cookieMaxAgeDays: z.natural().min(1).default(30),
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
})

/**
 * Provides carrier-neutral RPC and Fetch registries. When `webServer` is
 * present, the plugin also mounts the `/api` browser transport with Host/Origin
 * checks and persistent browser authentication.
 * @param ctx - Host plugin context.
 * @param config - resolved plugin config (schema defaults applied).
 */
export async function apply(ctx: Context, config?: ConnectionConfig): Promise<void> {
  const recovery = resolveConnectionConfig(config?.recovery)
  // The Loader resolves schema defaults; hand-built test contexts may pass none.
  const trustedHosts = config?.trustedHosts ?? []
  const cookieMaxAgeDays = config?.cookieMaxAgeDays ?? 30
  const maxRequestBodyBytes = config?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  // Config boundary: a malformed entry fails the load loudly here rather than
  // silently authorizing its hostname prefix at request time.
  for (const entry of trustedHosts) assertTrustedAuthority(entry)
  assertImageBodyCapacity(ctx, maxRequestBodyBytes)
  const identity = await createHostIdentity(ctx.root, ctx.credentials)
  const devices = config?.deviceAccess === undefined ? undefined : await DeviceAccess.create(ctx.credentials, identity, config.deviceAccess)
  if (devices !== undefined) {
    ctx.on('credentials/record-updated', (key) => {
      if (key !== DEVICE_ACCESS_KEY) return
      void devices.refresh().catch(() => { ctx.logger.warn('Device authorization unavailable') })
    })
    ctx.effect(() => () => devices.dispose(), 'client-connection: device access')
  }
  const connection = new HostConnectionService(
    ctx,
    trustedHosts,
    await BrowserAuth.create(ctx.root, ctx.credentials, cookieMaxAgeDays),
    identity,
    devices,
  )
  connection.rpc.handleRoute(CONNECTION_IDENTITY_ENDPOINT, (_endpoint, payload) => {
    if (!connectionIdentityRequestSchema.safeParse(payload).success) {
      return Promise.resolve({ ok: false, error: {
        code: 'connection/invalid-request', message: 'Host identity reads require an empty object', details: {},
      } })
    }
    return Promise.resolve({ ok: true, value: identity })
  })
  ctx.inject(['webServer'], (webCtx) => {
    assertImageBodyCapacity(webCtx, maxRequestBodyBytes)
    webCtx.on('webserver/index-inject', (table) => {
      table.push({ kind: 'global', name: '__DSH_CONNECTION_RECOVERY__', value: recovery })
    })
    const fetchHandler = connection.createSharedFetchHandler(API_PATH)
    const route: WebRoute = {
      kind: 'prefix',
      path: API_PATH,
      handler: async (req, res) => {
        const claiming = devices !== undefined && req.method === 'POST'
          && new URL(req.url ?? '/', 'http://dsh.internal').pathname === DEVICE_ACCESS_PATHS.claim
        const authorization: ConnectionRequestAuthorization = claiming
          ? isTrustedApiRequest(req, trustedHosts) ? { ok: true as const } : { ok: false as const, status: 403 as const }
          : await connection.authorizeRequest(req)
        if (!authorization.ok) {
          res.writeHead(authorization.status)
          res.end(authorization.status === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        try {
          const bodyLimit = claiming ? Math.min(maxRequestBodyBytes, DEVICE_CLAIM_MAX_BYTES) : maxRequestBodyBytes
          await bridge(req, res, fetchHandler, bodyLimit, authorization.lease?.signal)
        } finally { authorization.lease?.dispose() }
      },
    }
    webCtx.effect(() => webCtx.webServer.register(route), 'client-connection: /api route')
  })
  ctx.inject(['attachments'], (attachmentCtx) => {
    assertImageBodyCapacity(attachmentCtx, maxRequestBodyBytes)
  })
}

export type { ConnectionIdentity, ConnectionHostId, ConnectionActivationId } from './host-identity-protocol.ts'
