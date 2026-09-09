/** PDF resources are lazy, abortable, and independently transferable. */
import { describe, expect, it, vi } from 'vitest'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { createPdfBinaryDataFactory, createReadPdfAsset } from '../src/client/pdf/assets.ts'

function carrier(value: unknown) {
  return { call: vi.fn<ClientConnectionRpc['call']>().mockResolvedValue({ ok: true, value }) }
}

describe('PDF binary resources', () => {
  it('fetches only on demand through the active carrier and forwards document cancellation', async () => {
    const rpc = carrier('AQID')
    const controller = new AbortController()
    const Factory = createPdfBinaryDataFactory(createReadPdfAsset(rpc), controller.signal)
    const factory = new Factory()
    expect(rpc.call).not.toHaveBeenCalled()
    expect(Array.from(await factory.fetch({ kind: 'cMapUrl', filename: 'sample.bcmap' }))).toEqual([1, 2, 3])
    expect(rpc.call).toHaveBeenCalledWith('/api', 'pdf-assets', { kind: 'cMapUrl', filename: 'sample.bcmap' }, controller.signal)
    controller.abort()
    expect(controller.signal.aborted).toBe(true)
  })

  it('never shares a buffer that PDF.js may transfer away', async () => {
    const Factory = createPdfBinaryDataFactory(createReadPdfAsset(carrier('AQID')), new AbortController().signal)
    const factory = new Factory()
    const first = await factory.fetch({ kind: 'cMapUrl', filename: 'sample.bcmap' })
    structuredClone(first, { transfer: [first.buffer] })
    expect(first.byteLength).toBe(0)
    expect(Array.from(await factory.fetch({ kind: 'cMapUrl', filename: 'sample.bcmap' }))).toEqual([1, 2, 3])
  })

  it('rejects invalid wire data and declared Host failures', async () => {
    const signal = new AbortController().signal
    await expect(createReadPdfAsset(carrier({ bad: true }))('wasmUrl', 'decoder.wasm', signal))
      .rejects.toThrow('base64 text')
    await expect(createReadPdfAsset(carrier('!invalid'))('wasmUrl', 'decoder.wasm', signal)).rejects.toThrow()
    const rpc: ClientConnectionRpc = { call: vi.fn().mockResolvedValue({
      ok: false, error: { code: 'pdf/asset-not-found', message: 'PDF resource is not bundled', details: {} },
    }) }
    await expect(createReadPdfAsset(rpc)('wasmUrl', 'missing.wasm', signal)).rejects.toThrow('not bundled')
  })
})
