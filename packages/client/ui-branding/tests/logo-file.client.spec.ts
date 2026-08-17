// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { encodeProductLogo } from '@deepseek-ai/dsh-client-ui-branding/client'

function file(type: string, bytes: Uint8Array, size = bytes.byteLength): File {
  return {
    type, size,
    arrayBuffer: vi.fn(() => Promise.resolve(bytes.buffer)),
  } as unknown as File
}

describe('uploaded product logo encoding', () => {
  it('encodes supported bytes as base64', async () => {
    await expect(encodeProductLogo(file('image/png', new Uint8Array([97]))))
      .resolves.toBe('data:image/png;base64,YQ==')
  })

  it('rejects unsupported media and oversized files before reading', async () => {
    await expect(encodeProductLogo(file('image/svg+xml', new Uint8Array([1]))))
      .rejects.toMatchObject({ code: 'format' })
    await expect(encodeProductLogo(file('image/png', new Uint8Array([1]), 512 * 1024 + 1)))
      .rejects.toMatchObject({ code: 'size' })
  })

  it('encodes input larger than one conversion chunk', async () => {
    const bytes = new Uint8Array(0x8001)
    bytes.fill(97)
    const encoded = await encodeProductLogo(file('image/webp', bytes))
    expect(encoded).toMatch(/^data:image\/webp;base64,YWFh/)
  })
})
