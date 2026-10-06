// @vitest-environment jsdom
/** Explicit result reads, pending state, failure and retry. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DeferredToolResult } from '../src/client/DeferredToolResult.tsx'
import { t } from './locale.client.ts'

afterEach(cleanup)

it('loads only on request, disables duplicate actions, and exposes retry after failure', async () => {
  const first = Promise.withResolvers<undefined>()
  const load = vi.fn<(seq: number) => Promise<void>>().mockReturnValueOnce(first.promise)
    .mockRejectedValueOnce('offline').mockResolvedValueOnce()
  render(<DeferredToolResult seq={17} loadToolResult={load} t={t} />)
  expect(load).not.toHaveBeenCalled()
  expect(screen.getByText('Result not loaded')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Load full result' }))
  expect(load).toHaveBeenCalledExactlyOnceWith(17)
  expect(screen.getByRole('button', { name: 'Loading result…' }).hasAttribute('disabled')).toBe(true)
  await act(async () => { first.reject(new Error('detail unavailable')) })
  expect(screen.getByRole('alert').textContent).toBe('detail unavailable')
  fireEvent.click(screen.getByRole('button', { name: 'Load full result' }))
  await act(async () => {})
  expect(screen.getByRole('alert').textContent).toBe('offline')
  fireEvent.click(screen.getByRole('button', { name: 'Load full result' }))
  await act(async () => {})
  expect(load).toHaveBeenCalledTimes(3)
  expect(screen.queryByRole('alert')).toBeNull()
})

it.each(['resolve', 'reject'] as const)('leaves obsolete detail settlement to the Session owner (%s)', async (settle) => {
  const pending = Promise.withResolvers<undefined>()
  const view = render(<DeferredToolResult seq={17} loadToolResult={() => pending.promise} t={t} />)
  fireEvent.click(screen.getByRole('button', { name: 'Load full result' }))
  view.unmount()
  await act(async () => {
    if (settle === 'resolve') pending.resolve(undefined)
    else pending.reject(new Error('obsolete failure'))
  })
  expect(screen.queryByRole('alert')).toBeNull()
})
