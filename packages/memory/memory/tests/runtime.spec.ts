import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import MemoryRuntime from '@deepseek-ai/dsh-memory'
import type { MemoryProvider } from '@deepseek-ai/dsh-memory'

function provider(id: string): MemoryProvider {
  const unavailable = () => Promise.reject(new Error('unused'))
  return {
    id,
    query: unavailable,
    get: unavailable,
    propose: unavailable,
    challenge: unavailable,
    review: unavailable,
    supersede: unavailable,
    checkpoint: unavailable,
    delete: unavailable,
  }
}

describe('MemoryRuntime', () => {
  it('disposes provider contributions with their fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryRuntime)
    const fiber = await ctx.plugin(Object.assign((scope: Context) => { scope.memory.registerProvider(provider('test')) }, { inject: ['memory'] }))
    await expect(ctx.memory.query({ scope: { kind: 'global' }, text: 'x' })).rejects.toThrow('unused')
    await fiber.dispose()
    expect(() => ctx.memory.query({ scope: { kind: 'global' }, text: 'x' })).toThrow(expect.objectContaining({ code: 'MEMORY_PROVIDER_UNAVAILABLE' }))
  })

  it('rejects ambiguous and duplicate providers', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryRuntime)
    ctx.memory.registerProvider(provider('a'))
    expect(() => ctx.memory.registerProvider(provider('a'))).toThrow(expect.objectContaining({ code: 'MEMORY_DUPLICATE_PROVIDER' }))
    ctx.memory.registerProvider(provider('b'))
    expect(() => ctx.memory.query({ scope: { kind: 'global' }, text: 'x' })).toThrow(expect.objectContaining({ code: 'MEMORY_PROVIDER_AMBIGUOUS' }))
  })
})
