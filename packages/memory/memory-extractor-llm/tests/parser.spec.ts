import { describe, expect, it } from 'vitest'
import { parseMemoryExtractionResponse } from '../src/index.ts'

describe('memory extraction response parser', () => {
  it('accepts bounded strict proposal output', () => {
    expect(parseMemoryExtractionResponse([{ type: 'text', text: '{"proposals":[{"statement":"Uses pnpm","trust":0.8}]}' }], 2).proposals).toEqual([{ statement: 'Uses pnpm', trust: 0.8 }])
  })
  it('rejects non-text blocks, invalid confidence, and oversized results', () => {
    expect(() => parseMemoryExtractionResponse([{ type: 'reasoning', text: 'hidden' }], 1)).toThrow('text only')
    expect(() => parseMemoryExtractionResponse([{ type: 'text', text: '{"proposals":[{"statement":"x","trust":2}]}' }], 1)).toThrow('fields are invalid')
    expect(() => parseMemoryExtractionResponse([{ type: 'text', text: '{"proposals":[],"extra":true}' }], 1)).toThrow('strict proposal object')
    expect(() => parseMemoryExtractionResponse([{ type: 'text', text: '{"proposals":[{"statement":"x","trust":1,"extra":true}]}' }], 1)).toThrow('unknown fields')
    expect(() => parseMemoryExtractionResponse([{ type: 'text', text: '{"proposals":[{"statement":"a","trust":1},{"statement":"b","trust":1}]}' }], 1)).toThrow('too many')
  })
})
