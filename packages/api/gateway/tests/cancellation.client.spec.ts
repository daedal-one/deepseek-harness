/** Composed cancellation releases live source listeners at operation completion. */
import { expect, it, vi } from 'vitest'
import { combineRemoteCancellation } from '../src/client/cancellation.ts'

function tracked() {
  const controller = new AbortController()
  const add = vi.spyOn(controller.signal, 'addEventListener')
  const remove = vi.spyOn(controller.signal, 'removeEventListener')
  return { controller, signal: controller.signal, add, remove }
}

it('forwards the first abort reason and releases every source listener', () => {
  const first = tracked()
  const second = tracked()
  const scope = combineRemoteCancellation([first.signal, second.signal], () => new AbortController())
  const reason = { kind: 'caller stopped' }
  second.controller.abort(reason)
  first.controller.abort(new Error('later failure'))
  expect(scope.signal.reason).toBe(reason)
  expect(first.remove).toHaveBeenCalledExactlyOnceWith('abort', first.add.mock.calls[0]?.[1])
  expect(second.remove).toHaveBeenCalledExactlyOnceWith('abort', second.add.mock.calls[0]?.[1])
  scope.dispose()
  expect(first.remove).toHaveBeenCalledOnce()
})

it('selects the first already-aborted source without attaching any listeners', () => {
  const live = tracked()
  const stopped = tracked()
  const reason = new Error('already stopped')
  stopped.controller.abort(reason)
  const scope = combineRemoteCancellation([live.signal, stopped.signal], () => new AbortController())
  expect(scope.signal.reason).toBe(reason)
  expect(live.add).not.toHaveBeenCalled()
  expect(stopped.add).not.toHaveBeenCalled()
  live.controller.abort(new Error('later'))
  const both = combineRemoteCancellation([stopped.signal, live.signal], () => new AbortController())
  expect(both.signal.reason).toBe(reason)
})

it('deduplicates sources and releases them after successful operation completion', () => {
  const source = tracked()
  const scope = combineRemoteCancellation([source.signal, source.signal], () => new AbortController())
  expect(source.add).toHaveBeenCalledOnce()
  scope.dispose()
  scope.dispose()
  source.controller.abort(new Error('operation already finished'))
  expect(scope.signal.aborted).toBe(false)
  expect(source.remove).toHaveBeenCalledOnce()
})
