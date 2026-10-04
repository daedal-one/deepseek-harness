/** Resource ownership, canonical addresses, byte admission, and cancellation. */
import { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { ResourceRegistry } from '../../resources/src/client/resources.ts'
import { artifactAddress, readArtifactResource, registerArtifactResources } from '../src/client/resources.ts'
import type { ArtifactContent } from '@deepseek-ai/dsh-artifact/types'
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})
const content = { asset: { file: { bytes: 5 } }, data: btoa('Hello') } as ArtifactContent
function harness(limit = 10000) {
  const ctx = new Context()
  contexts.push(ctx)
  const read = vi.fn(
    async (
      _workspace: unknown,
      _artifact: unknown,
      _revision: unknown,
      _name: unknown,
      _signal: AbortSignal,
    ) => ({ ok: true as const, value: content }),
  )
  ctx.provide('remote', {
    artifacts: { policy: async () => ({ ok: true, value: { maxRetainedBytes: limit } }), read },
  } as never)
  ctx.provide('resources', new ResourceRegistry(ctx))
  const unregister = registerArtifactResources(ctx)
  const address = artifactAddress(
    'workspace' as never,
    'artifact' as never,
    'revision' as never,
    'dir/index.html',
  )
  return { ctx, read, address, unregister }
}
it('opens only exact canonical scoped resources and releases their retained state', async () => {
  const h = harness()
  expect(await readArtifactResource(h.ctx, h.address, new AbortController().signal)).toBe(content)
  expect(h.read.mock.calls[0]!.slice(0, 4)).toEqual(['workspace', 'artifact', 'revision', 'dir/index.html'])
  expect(h.ctx.resources.source(h.address).getSnapshot().value).toBeUndefined()
  await expect(
    readArtifactResource(h.ctx, h.address + '?query', new AbortController().signal),
  ).rejects.toThrow('address')
  expect(h.read).toHaveBeenCalledTimes(1)
})
it('refuses Resource admission before retaining an oversized asset', async () => {
  const h = harness(1)
  await expect(readArtifactResource(h.ctx, h.address, new AbortController().signal)).rejects.toThrow(
    'memory limit',
  )
  expect(h.ctx.resources.source(h.address).getSnapshot().value).toBeUndefined()
})
it('aborts the authenticated read when its last holder closes', async () => {
  const h = harness()
  const started = Promise.withResolvers<AbortSignal>()
  h.read.mockImplementationOnce(async (_w, _a, _r, _n, signal) => {
    started.resolve(signal)
    await new Promise<void>((resolve) => {
      signal.addEventListener(
        'abort',
        () => {
          resolve()
        },
        { once: true },
      )
    })
    signal.throwIfAborted()
    return { ok: true, value: content }
  })
  const controller = new AbortController()
  const result = readArtifactResource(h.ctx, h.address, controller.signal)
  const observed = await started.promise
  controller.abort(new Error('view closed'))
  await expect(result).rejects.toThrow('view closed')
  expect(observed.aborted).toBe(true)
})
it('invalidates a pending read when the protocol owner unloads', async () => {
  const h = harness()
  const started = Promise.withResolvers<undefined>()
  h.read.mockImplementationOnce(async (_w, _a, _r, _n, signal) => {
    started.resolve(undefined)
    await new Promise<void>((resolve) => {
      signal.addEventListener(
        'abort',
        () => {
          resolve()
        },
        { once: true },
      )
    })
    signal.throwIfAborted()
    return { ok: true, value: content }
  })
  const result = readArtifactResource(h.ctx, h.address, new AbortController().signal)
  await started.promise
  h.unregister()
  await expect(result).rejects.toThrow('unavailable')
})

it('reports authenticated policy refusal without reading any asset', async () => {
  const h = harness()
  vi.spyOn(h.ctx.remote.artifacts, 'policy').mockResolvedValueOnce({
    ok: false,
    error: new RemoteError('gateway/bad-request', 'policy refused', {}),
  })
  await expect(readArtifactResource(h.ctx, h.address, new AbortController().signal)).rejects.toThrow(
    'policy refused',
  )
  expect(h.read).not.toHaveBeenCalled()
})
it('reports non-Error failures from a Remote wire operation', async () => {
  const h = harness()
  h.read.mockRejectedValueOnce('connection disappeared')
  await expect(readArtifactResource(h.ctx, h.address, new AbortController().signal)).rejects.toThrow(
    'connection disappeared',
  )
})
it('turns a cancellation without an Error reason into an AbortError', async () => {
  const h = harness()
  const started = Promise.withResolvers<undefined>()
  h.read.mockImplementationOnce(async (_w, _a, _r, _n, signal) => {
    started.resolve(undefined)
    await new Promise<void>((resolve) => {
      signal.addEventListener(
        'abort',
        () => {
          resolve()
        },
        { once: true },
      )
    })
    signal.throwIfAborted()
    return { ok: true, value: content }
  })
  const controller = new AbortController()
  const reading = readArtifactResource(h.ctx, h.address, controller.signal)
  const rejection = expect(reading).rejects.toMatchObject({ name: 'AbortError' })
  await started.promise
  controller.abort('view closed')
  await rejection
})
