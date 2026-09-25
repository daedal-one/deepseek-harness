/** Exact HTTP enrollment and owner administration routes for device grants. */
import type { z } from 'zod'
import type { ConnectionFetchRoute, ConnectionRequestRejection } from './rpc.ts'
import { DeviceAccessError, type DeviceAccess } from './device-access.ts'
import { DEVICE_ACCESS_PATHS, deviceClaimSchema, deviceEnrollSchema, deviceRevokeSchema } from './device-protocol.ts'
import type { ConnectionIdentity } from './host-identity-protocol.ts'

function response(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
}

function failed(status: number, code: string): Response {
  return response({ ok: false, error: { code, message: 'Device access request refused', details: {} } }, status)
}

/**
 * Construct the Connection-owned routes; owner operations require the browser authority.
 * @param access - active grant and enrollment owner.
 * @param identity - current Host identity for public metadata.
 * @param ownerRejection - existing browser Host/Origin/authentication policy.
 * @returns exact routes withdrawn with the Connection plugin.
 */
export function deviceRoutes(
  access: DeviceAccess,
  identity: ConnectionIdentity,
  ownerRejection: (request: Request) => ConnectionRequestRejection,
): readonly ConnectionFetchRoute[] {
  function post<Input>(
    path: string, schema: z.ZodType<Input>, operation: (input: Input) => Promise<unknown>, owner: boolean,
  ): ConnectionFetchRoute {
    return { path, methods: ['POST'], requestBody: 'buffered', fetch: async (request) => {
      if (owner) {
        const rejection = ownerRejection(request)
        if (request.headers.has('authorization') || rejection !== undefined) return failed(rejection ?? 401, 'connection/owner-required')
      }
      if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
        return failed(415, 'connection/invalid-device-request')
      }
      let body: unknown
      try { body = await request.json() } catch { return failed(400, 'connection/invalid-device-request') }
      const parsed = schema.safeParse(body)
      if (!parsed.success) return failed(400, 'connection/invalid-device-request')
      if (request.signal.aborted) return failed(401, 'connection/device-access-cancelled')
      try { return response({ ok: true, value: await operation(parsed.data) }) } catch (error) {
        return error instanceof DeviceAccessError ? failed(error.status, error.code) : failed(500, 'connection/device-access-failed')
      }
    } }
  }
  return [
    post(DEVICE_ACCESS_PATHS.enroll, deviceEnrollSchema, () => access.enroll(), true),
    post(DEVICE_ACCESS_PATHS.claim, deviceClaimSchema, request => access.claim(request), false),
    post(DEVICE_ACCESS_PATHS.revoke, deviceRevokeSchema, async request => ({ revoked: await access.revoke(request.deviceId) }), true),
    { path: DEVICE_ACCESS_PATHS.list, methods: ['GET'], requestBody: 'buffered', fetch: async (request) => {
      const rejection = ownerRejection(request)
      if (request.headers.has('authorization') || rejection !== undefined) return failed(rejection ?? 401, 'connection/owner-required')
      try { return response({ ok: true, value: { version: 1, hostId: identity.hostId, devices: await access.list() } }) } catch (error) {
        return error instanceof DeviceAccessError ? failed(error.status, error.code) : failed(500, 'connection/device-access-failed')
      }
    } },
  ]
}
