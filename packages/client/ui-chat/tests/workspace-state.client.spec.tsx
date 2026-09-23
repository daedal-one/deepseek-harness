// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonCopy } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { ChatNodeViewProps } from '../src/client/contract/slots.ts'
import { WorkspaceStateNodeView } from '../src/client/chat/WorkspaceStateNodeView.tsx'
import { en } from '../src/client/locale.ts'

afterEach(cleanup)
const t = makeTranslate(en, commonCopy)
function view(data: Partial<ChatNodeViewProps<'workspace-state'>['node']['data']>) {
  // This leaf reads only durable node data and its locale; parent interaction props are unused.
  return render(<WorkspaceStateNodeView {...{ node: { data }, t } as ChatNodeViewProps<'workspace-state'>} />)
}

it('groups identical commits while keeping every returned alias expandable', () => {
  const result = view({ phase: 'returned', branches: {
    'refs/heads/dsh/fix-recovery-a/turn-4': 'a'.repeat(40),
    'refs/heads/dsh/fix-recovery-b/turn-4': 'a'.repeat(40),
    'refs/heads/dsh/add-tests-c/turn-4': 'b'.repeat(40),
  } })
  expect(result.container.querySelector('ul')!.children).toHaveLength(2)
  const summary = result.getByText('Other branches at this commit (1)')
  expect(summary.closest('details')!.open).toBe(false)
  fireEvent.click(summary)
  expect(summary.closest('details')!.open).toBe(true)
  expect(result.getByText('dsh/fix-recovery-b/turn-4')).toBeTruthy()
})

it('keeps equal commit ids in different repositories separate and includes secondary repositories', () => {
  const first = { remote: 'https://example.test/one', path: '/workspace/one', baseline: 'b'.repeat(40), lastTurn: 4,
    branches: { 'refs/heads/dsh/one/turn-4': 'a'.repeat(40) } }
  const second = { ...first, remote: 'https://example.test/two', branches: { 'refs/heads/dsh/two/turn-4': 'a'.repeat(40) } }
  const result = view({ phase: 'returned', branches: first.branches, repositories: [first, second] })
  expect(result.getByText(first.remote)).toBeTruthy()
  expect(result.getByText(second.remote)).toBeTruthy()
  expect(result.container.querySelectorAll('li')).toHaveLength(2)
  expect(result.container.querySelector('details')).toBeNull()
})

it.each(['saving', 'pending', 'checkpointed'] as const)('retains %s outcomes and error detail independently of branches', (phase) => {
  const result = view({ phase, branches: {}, error: 'Destination unavailable' })
  expect(result.getByRole('status').getAttribute('data-workspace-phase')).toBe(phase)
  expect(result.getByText('Destination unavailable')).toBeTruthy()
  expect(result.container.querySelector('ul')).toBeNull()
})
