import { describe, expect, it } from 'vitest'
import { DelayedAskState } from '../src/index.ts'

describe('DelayedAskState', () => {
  it('binds opportunities to exact session, turn, tool, and canonical arguments', () => {
    const state = new DelayedAskState({ threshold: 2, ttlMs: 100, maxEntries: 10 }, () => 0)
    expect(state.advance('s', 1, 'bash', { b: 2, a: 1 })).toMatchObject({ number: 1, ask: false })
    expect(state.advance('s', 1, 'bash', { a: 1, b: 2 })).toMatchObject({ number: 2, ask: true, spent: true })
    expect(state.advance('s', 1, 'bash', { a: 1, b: 2 })).toMatchObject({ ask: false, spent: true })
    expect(state.advance('other', 1, 'bash', { a: 1, b: 2 })).toMatchObject({ number: 1 })
    expect(state.advance('s', 2, 'bash', { a: 1, b: 2 })).toMatchObject({ number: 1 })
  })

  it('expires and prunes entries', () => {
    let now = 0
    const state = new DelayedAskState({ threshold: 2, ttlMs: 5, maxEntries: 1 }, () => now)
    state.advance('a', 1, 'bash', {})
    state.advance('b', 1, 'bash', {})
    expect(state.advance('a', 1, 'bash', {})).toMatchObject({ number: 1 })
    now = 10
    expect(state.advance('a', 1, 'bash', {})).toMatchObject({ number: 1 })
  })
})
