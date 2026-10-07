import { describe, expect, it } from 'vitest'
import { findModelPricing, parseModelsReply, usdPerToken } from '../src/parse.ts'

describe('parseModelsReply', () => {
  it('parses a valid models reply with raw string price slots', () => {
    const parsed = parseModelsReply({
      data: [
        {
          id: 'anthropic/claude-3',
          name: 'Claude 3',
          pricing: { prompt: '0.000003', completion: '0.000015', input_cache_read: '0.0000003', input_cache_write: '0.00000375' },
        },
        { id: 'passthrough-model', name: 'No fixed price', pricing: { prompt: '-1', completion: '-1' } },
        { id: 'bare-model' },
      ],
    })
    expect(parsed).toEqual({
      ok: true,
      value: [
        {
          id: 'anthropic/claude-3',
          pricing: { prompt: '0.000003', completion: '0.000015', cacheRead: '0.0000003', cacheWrite: '0.00000375' },
        },
        { id: 'passthrough-model', pricing: { prompt: '-1', completion: '-1', cacheRead: null, cacheWrite: null } },
        { id: 'bare-model', pricing: { prompt: null, completion: null, cacheRead: null, cacheWrite: null } },
      ],
    })
  })

  it('skips elements without a usable string id without failing', () => {
    const parsed = parseModelsReply({
      data: [
        { name: 'anonymous' },
        { id: '' },
        { id: 3 },
        'junk',
        42,
        { id: 'real-model', pricing: { prompt: '0', completion: '0' } },
      ],
    })
    expect(parsed).toEqual({
      ok: true,
      value: [{ id: 'real-model', pricing: { prompt: '0', completion: '0', cacheRead: null, cacheWrite: null } }],
    })
  })

  it('rejects an unusable envelope', () => {
    expect(parseModelsReply(null)).toMatchObject({ ok: false })
    expect(parseModelsReply({})).toMatchObject({ ok: false, detail: '"data" must be an array' })
    expect(parseModelsReply({ data: 'nope' })).toMatchObject({ ok: false, detail: '"data" must be an array' })
    expect(parseModelsReply({ data: [{ id: 'm', pricing: 'cheap' }] }))
      .toMatchObject({ ok: false, detail: '"data[0].pricing" must be an object' })
  })
})

describe('findModelPricing', () => {
  const models = [
    { id: 'a/b', pricing: { prompt: '1', completion: '2', cacheRead: null, cacheWrite: null } },
    { id: 'c/d', pricing: { prompt: null, completion: null, cacheRead: null, cacheWrite: null } },
  ]

  it('hits on an exact model id', () => {
    expect(findModelPricing(models, 'a/b')).toEqual({ prompt: '1', completion: '2', cacheRead: null, cacheWrite: null })
  })

  it('misses on a non-exact model id', () => {
    expect(findModelPricing(models, 'a/b-other')).toBeUndefined()
    expect(findModelPricing([], 'a/b')).toBeUndefined()
  })
})

describe('usdPerToken', () => {
  it('prices a normal per-token string', () => {
    expect(usdPerToken('0.000001')).toBe(0.000001)
  })

  it('prices zero as a legitimate price', () => {
    expect(usdPerToken('0')).toBe(0)
  })

  it('treats the -1 pass-through marker as unpriceable', () => {
    expect(usdPerToken('-1')).toBeNull()
  })

  it('treats any negative value as unpriceable', () => {
    expect(usdPerToken('-0.5')).toBeNull()
  })

  it('treats a non-numeric string as unpriceable', () => {
    expect(usdPerToken('abc')).toBeNull()
  })

  it('treats blank and whitespace-only prices as unpriceable rather than zero', () => {
    expect(usdPerToken('')).toBeNull()
    expect(usdPerToken('   ')).toBeNull()
    expect(usdPerToken('\t\n')).toBeNull()
  })

  it('treats an absent slot as unpriceable', () => {
    expect(usdPerToken(null)).toBeNull()
  })

  it('treats non-finite values as unpriceable', () => {
    expect(usdPerToken('Infinity')).toBeNull()
    expect(usdPerToken('-Infinity')).toBeNull()
    expect(usdPerToken('NaN')).toBeNull()
  })
})
