/** Per-host transport and network isolation through the portable Connection entry. */
import { afterEach, expect, it, vi } from 'vitest'
import {
  createConnection,
  createConnectionRpc,
  RpcId,
  type ConnectionGenerationSource,
  type ConnectionNetworkSource,
  type RpcFetch,
} from '@deepseek-ai/dsh-client-connection/client/portable'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

class Network implements ConnectionNetworkSource {
  available = true
  readonly listeners = new Set<() => void>()
  getSnapshot(): boolean { return this.available }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  set(available: boolean): void {
    this.available = available
    for (const listener of this.listeners) listener()
  }
}

function rpc(host: string, fetch: RpcFetch) {
  let request = 0
  return createConnectionRpc({ baseUrl: `https://${host}`, fetch, randomId: () => RpcId(`${host}-${++request}`) })
}

function generation(home: string) {
  const signals: AbortSignal[] = []
  const done: Promise<void>[] = []
  const source: ConnectionGenerationSource = (signal, ready) => {
    signals.push(signal)
    const settled = new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => { resolve() }, { once: true })
      ready({ home })
      if (signal.aborted) resolve()
    })
    done.push(settled)
    return settled
  }
  return { signals, done, source }
}

it('uses separate authorities and correlation sources without ambient fetch or crypto', async () => {
  vi.stubGlobal('fetch', undefined)
  vi.stubGlobal('crypto', undefined)
  vi.stubGlobal('location', undefined)
  const seen: Array<{ url: string; rpcId: string; signal: AbortSignal | null | undefined }> = []
  const fetch: RpcFetch = async (url, init) => {
    if (typeof init.body !== 'string') throw new TypeError('RPC body must be JSON text')
    const request = JSON.parse(init.body) as { rpcId: string }
    seen.push({ url: url.href, rpcId: request.rpcId, signal: init.signal })
    return Response.json({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: url.hostname } })
  }
  const first = rpc('first.example', fetch)
  const second = rpc('second.example', fetch)
  const abort = new AbortController()
  const results = await Promise.all([
    first.call('/api', 'sessions/list', {}, abort.signal),
    second.call('/api', 'sessions/list', {}),
    first.call('/api', 'sessions/list', {}),
  ])
  expect(results).toEqual([
    { ok: true, value: 'first.example' }, { ok: true, value: 'second.example' }, { ok: true, value: 'first.example' },
  ])
  expect(seen).toEqual([
    { url: 'https://first.example/api/sessions/list', rpcId: 'first.example-1', signal: abort.signal },
    { url: 'https://second.example/api/sessions/list', rpcId: 'second.example-1', signal: undefined },
    { url: 'https://first.example/api/sessions/list', rpcId: 'first.example-2', signal: undefined },
  ])
})

it('leaves a lost mutation response rejected without resending the command', async () => {
  const failure = new Error('response lost after acceptance')
  const fetch = vi.fn<RpcFetch>().mockRejectedValue(failure)
  await expect(rpc('host.example', fetch).call('/api', 'sessions/prompt', { text: 'once' }))
    .rejects.toBe(failure)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('keeps direct stream ordering and cancellation owned by the injected carrier', async () => {
  const abort = new AbortController()
  let closed = false
  const openStream = vi.fn(async function* (_endpoint: string, _payload: unknown, signal: AbortSignal) {
    try {
      yield 1
      if (!signal.aborted) yield 2
    } finally {
      closed = true
    }
  })
  const caller = createConnectionRpc({
    baseUrl: 'https://host.example', fetch: vi.fn(), randomId: () => RpcId('r'), openStream,
  })
  const stream = caller.open!('/api', 'sessions/follow', { session: 's' }, abort.signal)
  const iterator = stream[Symbol.asyncIterator]()
  expect(await iterator.next()).toEqual({ value: 1, done: false })
  abort.abort()
  expect(await iterator.next()).toEqual({ value: undefined, done: true })
  expect(closed).toBe(true)
  expect(openStream).toHaveBeenCalledWith('sessions/follow', { session: 's' }, abort.signal)
})

it('suspends one host without clearing another host and releases network subscriptions on stop', async () => {
  const networkA = new Network()
  const networkB = new Network()
  const a = createConnection({ rpc: rpc('a.example', vi.fn()), isLoopback: false, network: networkA })
  const b = createConnection({ rpc: rpc('b.example', vi.fn()), isLoopback: true, network: networkB })
  const sourceA = generation('/first')
  const sourceB = generation('/second')
  a.registerGenerationSource(sourceA.source)
  b.registerGenerationSource(sourceB.source)
  const loopA = a.start({})
  const loopB = b.start({})
  try {
    await vi.waitFor(() => {
      expect(a.generation.getSnapshot()?.host.home).toBe('/first')
      expect(b.generation.getSnapshot()?.host.home).toBe('/second')
    })
    expect(a.isLoopback).toBe(false)
    expect(b.isLoopback).toBe(true)
    networkA.set(false)
    await Promise.all(sourceA.done)
    expect(a.generation.getSnapshot()).toBeUndefined()
    expect(a.state.getSnapshot()).toBe('disconnected')
    expect(b.generation.getSnapshot()?.host.home).toBe('/second')
    expect(sourceB.signals[0]?.aborted).toBe(false)
    a.reconnect()
    await vi.waitFor(() => { expect(a.generation.getSnapshot()?.id).toBe(2) })
    expect(b.generation.getSnapshot()?.id).toBe(1)
  } finally {
    loopA.stop()
    loopB.stop()
    await Promise.all([...sourceA.done, ...sourceB.done])
  }
  expect(networkA.listeners.size).toBe(0)
  expect(networkB.listeners.size).toBe(0)
  expect(a.state.getSnapshot()).toBeUndefined()
  expect(b.state.getSnapshot()).toBeUndefined()
})

it('starts offline without opening a generation and withdraws its observer with the source', async () => {
  const network = new Network()
  network.available = false
  const source = generation('/host')
  const connection = createConnection({ rpc: rpc('host.example', vi.fn()), isLoopback: false, network })
  const unregister = connection.registerGenerationSource(source.source)
  const loop = connection.start({})
  try {
    expect(connection.state.getSnapshot()).toBe('disconnected')
    expect(source.signals).toHaveLength(0)
    unregister()
    expect(network.listeners.size).toBe(0)
    network.set(true)
    expect(source.signals).toHaveLength(0)
  } finally {
    loop.stop()
  }
})

it('uses caller-owned controllers through replacement and loop shutdown', async () => {
  const controllers: AbortController[] = []
  const createAbortController = (): AbortController => {
    const controller = new AbortController()
    controllers.push(controller)
    return controller
  }
  const host = generation('/native')
  const connection = createConnection({
    isLoopback: false, rpc: { call: async () => ({ ok: true, value: null }) }, createAbortController,
  })
  const unregister = connection.registerGenerationSource(host.source)
  const loop = connection.start({})
  try {
    await vi.waitFor(() => { expect(connection.generation.getSnapshot()?.id).toBe(1) })
    expect(host.signals[0]).toBe(controllers[0]?.signal)
    connection.reconnect()
    await vi.waitFor(() => { expect(connection.generation.getSnapshot()?.id).toBe(2) })
    expect(controllers[0]?.signal.aborted).toBe(true)
    expect(controllers[0]?.signal.reason).toBeDefined()
    expect(host.signals[1]).toBe(controllers[1]?.signal)
  } finally {
    loop.stop()
    unregister()
    await Promise.all(host.done)
  }
  expect(controllers).toHaveLength(2)
  expect(controllers.every(controller => controller.signal.aborted)).toBe(true)
})
