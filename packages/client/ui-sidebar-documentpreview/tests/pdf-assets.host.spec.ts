/** Host resource admission and lifetime over the shared authenticated carrier. */
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/index.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('PDF resource Host', () => {
  it('serves only exact bundled names and withdraws the route on disposal', async () => {
    vi.stubGlobal('__DSH_PDFJS_ASSETS__', {
      cMapUrl: { 'sample.bcmap': 'AQID' }, standardFontDataUrl: {}, wasmUrl: {}, workerSource: {},
    })
    const ctx = new Context()
    const connection = new HostConnectionService(ctx, [], {} as BrowserAuth)
    const shared = connection.createSharedFetchHandler('/api')
    const fiber = ctx.plugin({ apply, inject })
    try {
      await fiber.await()
      const read = async (payload: unknown, method = 'pdf-assets') => shared.fetch(new Request('http://localhost/api/pdf-assets', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'resource', method, payload }),
      }))
      expect(await (await read({ kind: 'cMapUrl', filename: 'sample.bcmap' })).json())
        .toMatchObject({ result: { ok: true, value: 'AQID' } })
      for (const payload of [null, { kind: 'unknown', filename: 'sample.bcmap' },
        ...['../sample.bcmap', 'toString', 'missing'].map(filename => ({ kind: 'cMapUrl', filename }))]) {
        expect(await (await read(payload)).json()).toMatchObject({ result: { ok: false, error: { code: 'pdf/asset-not-found' } } })
      }
      expect(await (await read({}, 'wrong-method')).json())
        .toMatchObject({ result: { ok: false, error: { code: 'gateway/bad-request' } } })
    } finally {
      await fiber.dispose()
    }
    expect((await shared.fetch(new Request('http://localhost/api/pdf-assets', { method: 'POST' }))).status).toBe(404)
    await ctx.fiber.dispose()
  })
})
