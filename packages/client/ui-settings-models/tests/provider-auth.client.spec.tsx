// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AccountAttemptId, AccountPromptId, ProviderAccount } from '@deepseek-ai/dsh-api-remotes/client'
import { ProviderAuthControl } from '../src/client/ProviderAuthControl.tsx'
import type { ModelsOperations } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const t = (key: keyof typeof en): string => en[key]
const id = 'attempt' as AccountAttemptId
const promptId = 'prompt' as AccountPromptId
const key = 'llm-pi-ai/openai-codex' as ProviderAccount['key']

it('shows device instructions, sends an answer write-only, and reflects successful sign-in and sign-out', async () => {
  const finished = Promise.withResolvers<undefined>()
  let configured = false
  const operations: Pick<ModelsOperations, 'listAccounts' | 'signIn' | 'answerAccount' | 'signOut'> = {
    listAccounts: async () => [{ key, label: 'Codex', methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }], configured, inFlight: false }],
    signIn: async (_key, _method, _signal, update) => {
      update({ id, status: 'pending', url: 'https://auth.example/device', code: 'ABCD', prompt: { id: promptId, kind: 'secret', message: 'Confirmation code' } })
      await finished.promise
      configured = true
      update({ id, status: 'authorized' })
    },
    answerAccount: vi.fn(async () => { finished.resolve(undefined) }),
    signOut: async () => { configured = false },
  }
  const onAccountOnly = vi.fn()
  render(<ProviderAuthControl provider="openai-codex" operations={operations} t={t} disabled={false} onAccountOnly={onAccountOnly} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with ChatGPT' }))
  expect(screen.getByRole('link', { name: 'Continue sign-in' }).getAttribute('href')).toBe('https://auth.example/device')
  expect(screen.getByText('ABCD')).toBeTruthy()
  const input = screen.getByLabelText('Confirmation code')
  expect(input.getAttribute('type')).toBe('password')
  fireEvent.change(input, { target: { value: 'private-answer' } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByText('Signed in', { exact: true })
  expect(operations.answerAccount).toHaveBeenCalledWith(id, promptId, 'private-answer')
  expect(screen.queryByText('private-answer')).toBeNull()
  expect(onAccountOnly).toHaveBeenCalledWith(true)
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
  await screen.findByText('Not signed in', { exact: true })
})

it('aborts an active sign-in on cancellation and on editor removal', async () => {
  const signals: AbortSignal[] = []
  const operations: Pick<ModelsOperations, 'listAccounts' | 'signIn' | 'answerAccount' | 'signOut'> = {
    listAccounts: async () => [{ key, label: 'Codex', methods: [{ id: 'oauth', label: 'Sign in' }], configured: false, inFlight: false }],
    signIn: async (_key, _method, signal) => {
      signals.push(signal)
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    },
    answerAccount: async () => {},
    signOut: async () => {},
  }
  const view = render(<ProviderAuthControl provider="openai-codex" operations={operations} t={t} disabled={false} onAccountOnly={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(signals[0]?.aborted).toBe(true)
  await screen.findByText('Sign-in cancelled.')
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
  await waitFor(() => { expect(signals).toHaveLength(2) })
  view.unmount()
  expect(signals[1]?.aborted).toBe(true)
})
