import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmConfigurableProvider, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { LlmProviderAuthenticator } from '@deepseek-ai/dsh-llm'

class NoopAdapter extends LlmAdapter {

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('not exercised')
  }
}

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  return ctx
}

function entry(overrides: Partial<LlmConfigurableProvider> = {}): LlmConfigurableProvider {
  return {
    provider: 'openai',
    displayName: 'OpenAI',
    settingsNs: 'llm-pi-ai',
    settingsPath: ['providers', 'openai'],
    ...overrides,
  }
}

describe('llm/adapters-updated', () => {
  it('fires at both adapter registration commit points with the registry already readable', async () => {
    const ctx = await setup()
    const observed: string[][] = []
    ctx.on('llm/adapters-updated', () => {
      observed.push(ctx.llm.listProviders().map(provider => provider.id))
    })
    const dispose = ctx.llm.registerAdapter(['a', 'b'], new NoopAdapter())
    expect(observed).toEqual([['a', 'b']])
    dispose()
    expect(observed).toEqual([['a', 'b'], []])
  })

  it('contains a throwing listener without vetoing registration or starving later listeners', async () => {
    const ctx = await setup()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    const later = vi.fn()
    ctx.on('llm/adapters-updated', () => {
      throw new Error('broken observer')
    })
    ctx.on('llm/adapters-updated', later)
    ctx.llm.registerAdapter(['a'], new NoopAdapter())
    expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['a'])
    expect(later).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('llm: an llm/adapters-updated listener failed')
  })

  it('contains an ASYNC listener rejection instead of leaving it unhandled', async () => {
    // An emit listener may be an async function; its rejection cannot reach
    // the synchronous catch, so an uncontained one escapes the process as an
    // unhandled rejection rather than a warned observer failure.
    const ctx = await setup()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      // Typed as returning unknown so the listener is not a Promise-returning
      // function type: the point is exactly that an async one may slip in.
      const rejecting = (): unknown => Promise.reject(new Error('async observer'))
      ctx.on('llm/adapters-updated', rejecting)
      ctx.llm.registerAdapter(['a'], new NoopAdapter())
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['a'])
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(unhandled).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledWith('llm: an llm/adapters-updated listener failed')
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('replaces a route set in one event, never publishing an empty registry between the two', async () => {
    // The retry-policy swap in llm-deepseek: disposing and re-registering
    // would let an observer see the provider disappear and come back.
    const ctx = await setup()
    const observed: string[][] = []
    const registration = ctx.llm.registerAdapter(['a'], new NoopAdapter())
    ctx.on('llm/adapters-updated', () => {
      observed.push(ctx.llm.listProviders().map(provider => provider.id))
    })
    registration.replace(['a'])
    expect(observed).toEqual([['a']])
  })

  it('rethrows the first INVARIANT-coded listener failure after notifying the rest', async () => {
    const ctx = await setup()
    const later = vi.fn()
    ctx.on('llm/adapters-updated', () => {
      throw Object.assign(new Error('registry incoherent'), { code: 'INVARIANT' })
    })
    ctx.on('llm/adapters-updated', later)
    expect(() => ctx.llm.registerAdapter(['a'], new NoopAdapter())).toThrow('registry incoherent')
    expect(later).toHaveBeenCalledTimes(1)
  })
})

describe('configurable-provider directory', () => {
  it('registers entries, lists detached copies in order, and fires the topology event', async () => {
    const ctx = await setup()
    const events = vi.fn()
    ctx.on('llm/adapters-updated', events)
    ctx.llm.registerConfigurableProviders([
      entry({ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] }),
      entry(),
    ])
    expect(events).toHaveBeenCalledTimes(1)
    const listed = ctx.llm.listConfigurableProviders()
    expect(listed).toEqual([
      { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
      { provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
    ])
    listed[0]!.displayName = 'mutated'
    ;(listed[1]!.settingsPath as string[]).push('mutated')
    expect(ctx.llm.listConfigurableProviders()[0]!.displayName).toBe('DeepSeek')
    expect(ctx.llm.listConfigurableProviders()[1]!.settingsPath).toEqual(['providers', 'openai'])
  })

  it('detaches stored entries from caller-owned objects', async () => {
    const ctx = await setup()
    const source = entry()
    ctx.llm.registerConfigurableProviders([source])
    source.displayName = 'mutated'
    expect(ctx.llm.listConfigurableProviders()[0]!.displayName).toBe('OpenAI')
  })

  it('validates and detaches provider authentication metadata', async () => {
    const ctx = await setup()
    const source = entry({ authMethods: [{ type: 'oauth', name: 'Account' }] })
    ctx.llm.registerConfigurableProviders([source])
    const listed = ctx.llm.listConfigurableProviders()
    expect(listed[0]?.authMethods).toEqual([{ type: 'oauth', name: 'Account' }])
    ;(source.authMethods as Array<{ type: 'oauth'; name: string }>)[0]!.name = 'mutated'
    ;(listed[0]!.authMethods as Array<{ type: 'oauth'; name: string }>)[0]!.name = 'also mutated'
    expect(ctx.llm.listConfigurableProviders()[0]?.authMethods).toEqual([{ type: 'oauth', name: 'Account' }])
    expect(() => ctx.llm.registerConfigurableProviders([
      entry({ provider: 'bad', authMethods: [{ type: 'oauth', name: '' }] }),
    ])).toThrow(/invalid or duplicate/)
    expect(() => ctx.llm.registerConfigurableProviders([
      entry({ provider: 'duplicate', authMethods: [
        { type: 'oauth', name: 'One' },
        { type: 'oauth', name: 'Two' },
      ] }),
    ])).toThrow(/invalid or duplicate/)
  })

  it('withdraws every entry when the registration disposes', async () => {
    const ctx = await setup()
    const dispose = ctx.llm.registerConfigurableProviders([entry()])
    const events = vi.fn()
    ctx.on('llm/adapters-updated', events)
    dispose()
    expect(ctx.llm.listConfigurableProviders()).toEqual([])
    expect(events).toHaveBeenCalledTimes(1)
  })

  it('withdraws entries when the contributing fiber disposes', async () => {
    const ctx = await setup()
    const fiber = await ctx.plugin({
      inject: ['llm'],
      apply: (child: Context) => {
        child.llm.registerConfigurableProviders([entry()])
      },
    })
    expect(ctx.llm.listConfigurableProviders()).toHaveLength(1)
    await fiber.dispose()
    expect(ctx.llm.listConfigurableProviders()).toEqual([])
  })

  it('rejects an empty registration', async () => {
    const ctx = await setup()
    expect(() => ctx.llm.registerConfigurableProviders([])).toThrow(LlmError)
    expect(() => ctx.llm.registerConfigurableProviders([])).toThrow(/at least one provider/)
  })

  it.each([
    [entry({ provider: '' }), /non-empty provider/],
    [entry({ displayName: '' }), /non-empty provider/],
    [entry({ settingsNs: '' }), /non-empty provider/],
    [entry({ settingsPath: ['providers', ''] }), /empty settingsPath segment/],
  ])('rejects invalid entries all-or-nothing', async (invalid, message) => {
    const ctx = await setup()
    expect(() => ctx.llm.registerConfigurableProviders([entry({ provider: 'valid-first' }), invalid])).toThrow(message)
    expect(ctx.llm.listConfigurableProviders()).toEqual([])
  })

  it('replaces its entries atomically, keeping the old set when a candidate collides', async () => {
    const ctx = await setup()
    const handle = ctx.llm.registerConfigurableProviders([entry(), entry({ provider: 'second' })])
    ctx.llm.registerConfigurableProviders([entry({ provider: 'owned-elsewhere' })])

    // A candidate another registration already declares refuses the whole swap.
    expect(() =>{  handle.replace([entry({ provider: 'owned-elsewhere' })]) }).toThrow(/already declared/)
    expect(ctx.llm.listConfigurableProviders().map(view => view.provider).sort())
      .toEqual(['owned-elsewhere', 'second', entry().provider].sort())

    // Its own entries are not "already declared" against itself, so a swap that
    // keeps one and drops another lands whole.
    handle.replace([entry({ displayName: 'Renamed' })])
    expect(ctx.llm.listConfigurableProviders().map(view => view.provider).sort())
      .toEqual(['owned-elsewhere', entry().provider].sort())
    expect(ctx.llm.listConfigurableProviders().find(view => view.provider === entry().provider)?.displayName)
      .toBe('Renamed')

    // An empty replace is legal, unlike an empty initial registration.
    handle.replace([])
    expect(ctx.llm.listConfigurableProviders().map(view => view.provider)).toEqual(['owned-elsewhere'])

    handle()
    expect(() =>{  handle.replace([entry()]) }).toThrow(/was disposed/)
  })

  it('rejects duplicates within one registration and across registrations', async () => {
    const ctx = await setup()
    expect(() => ctx.llm.registerConfigurableProviders([entry(), entry()])).toThrow(/already declared/)
    ctx.llm.registerConfigurableProviders([entry()])
    expect(() => ctx.llm.registerConfigurableProviders([entry({ displayName: 'Other' }), entry({ provider: 'unseen' })]))
      .toThrow(/already declared/)
    expect(ctx.llm.listConfigurableProviders()).toHaveLength(1)
  })
})

describe('provider authentication', () => {
  it('publishes device authorization and reaches a bounded success state', async () => {
    const ctx = await setup()
    const login = Promise.withResolvers<undefined>()
    const authenticator: LlmProviderAuthenticator = {
      method: { type: 'oauth', name: 'Test account' },
      authenticated: () => Promise.resolve(false),
      login: async (_signal, notify) => {
        notify({
          type: 'device-code',
          authorization: { userCode: 'ABCD-EFGH', verificationUri: 'https://example.test/device' },
        })
        await login.promise
      },
      logout: () => Promise.resolve(),
    }
    ctx.llm.registerProviderAuthenticator('test', authenticator)
    await expect(ctx.llm.providerAuthentication('test')).resolves.toEqual([
      { type: 'oauth', name: 'Test account', authenticated: false },
    ])

    const started = ctx.llm.startProviderAuthentication('test', 'oauth')
    await vi.waitFor(() => {
      expect(ctx.llm.authenticationOperation(started.id)).toMatchObject({
        status: 'pending',
        authorization: { userCode: 'ABCD-EFGH', verificationUri: 'https://example.test/device' },
      })
    })
    expect(() => ctx.llm.startProviderAuthentication('test', 'oauth')).toThrow(/already has a pending/)
    login.resolve(undefined)
    await vi.waitFor(() => { expect(ctx.llm.authenticationOperation(started.id).status).toBe('succeeded') })
  })

  it('cancels and drains login before logout can delete its credential', async () => {
    const ctx = await setup()
    const login = Promise.withResolvers<undefined>()
    let stored = false
    const logout = vi.fn(async () => { stored = false })
    ctx.llm.registerProviderAuthenticator('test', {
      method: { type: 'oauth', name: 'Test account' },
      authenticated: () => Promise.resolve(stored),
      // Deliberately ignores cancellation until the test releases it. The LLM
      // service still must not let logout run first and be undone afterward.
      login: async () => {
        await login.promise
        stored = true
      },
      logout,
    })
    const started = ctx.llm.startProviderAuthentication('test', 'oauth')
    const loggingOut = ctx.llm.logoutProvider('test', 'oauth')
    await Promise.resolve()
    expect(logout).not.toHaveBeenCalled()
    login.resolve(undefined)
    await loggingOut
    expect(logout).toHaveBeenCalledTimes(1)
    expect(stored).toBe(false)
    expect(ctx.llm.authenticationOperation(started.id).status).toBe('cancelled')
  })

  it('aborts and drains a registration operation when its owner disposes', async () => {
    const ctx = await setup()
    const aborted = Promise.withResolvers<undefined>()
    const fiber = ctx.plugin({
      inject: ['llm'],
      apply(child: Context) {
        child.llm.registerProviderAuthenticator('test', {
          method: { type: 'oauth', name: 'Test account' },
          authenticated: () => Promise.resolve(false),
          login: signal => new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              aborted.resolve(undefined)
              reject(new Error('aborted'))
            }, { once: true })
          }),
          logout: () => Promise.resolve(),
        })
      },
    })
    await fiber
    const started = ctx.llm.startProviderAuthentication('test', 'oauth')
    await fiber.dispose()
    await aborted.promise
    expect(ctx.llm.authenticationOperation(started.id).status).toBe('cancelled')
    await expect(ctx.llm.providerAuthentication('test')).resolves.toEqual([])
  })

  it('fails loud for unknown methods and operation ids', async () => {
    const ctx = await setup()
    expect(() => ctx.llm.startProviderAuthentication('missing', 'oauth')).toThrow(/has no "oauth"/)
    expect(() => ctx.llm.authenticationOperation('missing' as never)).toThrow(/unknown authentication operation/)
  })
})

describe('model discovery registry', () => {
  it('offers one interrogation per settings namespace and disposes with its fiber', async () => {
    const ctx = await setup()
    const discover = vi.fn(() => Promise.resolve([{ id: 'from-endpoint' }]))

    const dispose = ctx.llm.registerModelDiscovery('llm-example', discover)
    await expect(ctx.llm.discoverModels('llm-example', { baseURL: 'https://gateway.example/v1' }))
      .resolves.toEqual([{ id: 'from-endpoint' }])
    expect(discover).toHaveBeenCalledWith({ baseURL: 'https://gateway.example/v1' })

    // Disposal is observed through the offer itself, which is the only thing
    // the registration ever produced.
    dispose()
    await expect(ctx.llm.discoverModels('llm-example', { baseURL: 'https://gateway.example/v1' }))
      .rejects.toThrow(/no model discovery is registered/)
  })

  it('rejects an unnamed namespace and a second registration of the same one', async () => {
    const ctx = await setup()
    const discover = (): Promise<never[]> => Promise.resolve([])

    expect(() => ctx.llm.registerModelDiscovery('', discover)).toThrow(/non-empty settings namespace/)
    ctx.llm.registerModelDiscovery('llm-example', discover)
    expect(() => ctx.llm.registerModelDiscovery('llm-example', discover)).toThrow(/already registered/)
    // The refused second registration left the first one serving.
    await expect(ctx.llm.discoverModels('llm-example', { baseURL: 'https://gateway.example/v1' }))
      .resolves.toEqual([])
  })

  it('normalizes what an interrogation returns without inventing capacities', async () => {
    const ctx = await setup()
    ctx.llm.registerModelDiscovery('llm-example', () => Promise.resolve([
      { id: 'keep', name: 'Keep', contextWindow: 1024, maxTokens: 256 },
      { id: '' },
      { id: 'keep' },
      { id: 'bare' },
    ] as never))

    expect(await ctx.llm.discoverModels('llm-example', { baseURL: 'https://gateway.example/v1' })).toEqual([
      { id: 'keep', name: 'Keep', contextWindow: 1024, maxTokens: 256 },
      { id: 'bare' },
    ])
  })

  it('refuses a namespace nothing serves and a draft with no endpoint', async () => {
    const ctx = await setup()
    ctx.llm.registerModelDiscovery('llm-example', () => Promise.resolve([]))

    await expect(ctx.llm.discoverModels('llm-absent', { baseURL: 'https://gateway.example/v1' }))
      .rejects.toMatchObject({ code: 'NO_DISCOVERY' })
    await expect(ctx.llm.discoverModels('llm-example', { baseURL: '' }))
      .rejects.toMatchObject({ code: 'INVALID_DISCOVERY' })
    await expect(ctx.llm.discoverModels('llm-example', { provider: '', baseURL: '' }))
      .rejects.toMatchObject({ code: 'INVALID_DISCOVERY' })
    await expect(ctx.llm.discoverModels('llm-example', {}))
      .rejects.toMatchObject({ code: 'INVALID_DISCOVERY' })
    // Naming a route alone is enough: the adapter may know it without an endpoint.
    await expect(ctx.llm.discoverModels('llm-example', { provider: 'known-route' })).resolves.toEqual([])
  })
})
