// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { PermissionSelect } from '../src/client/skeleton/PermissionSelect.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const options = [
  { value: 'workspace-write', name: 'workspace-write' },
  { value: 'policy-reviewed', name: 'Policy reviewed' },
]
const t = makeTranslate(en)

it('keeps environment separate from policy and labels a creation override', async () => {
  const command = vi.fn(async () => true)
  const view = render(<PermissionSelect value={{ options, currentValue: 'workspace-write', canChange: true,
    context: { environment: 'container', defaultPreset: 'workspace-write' } }} locked={false} command={command} t={t} />)
  fireEvent.click(view.getByRole('button', { name: /Container · Workspace Write/ }))
  expect(view.getByText('Runs in a container · this policy cannot grant host access')).toBeTruthy()
  expect(view.getByText('Profile default')).toBeTruthy()
  fireEvent.click(view.getByRole('menuitem', { name: 'Policy reviewed' }))
  expect(command).toHaveBeenCalledWith('/permission policy-reviewed')
})

it('lets an existing session explain its access without offering a switch', () => {
  const command = vi.fn(async () => true)
  const view = render(<PermissionSelect value={{ options, currentValue: 'policy-reviewed', canChange: false,
    context: { environment: 'host', defaultPreset: 'workspace-write' } }} locked={false} command={command} t={t} />)
  fireEvent.click(view.getByRole('button', { name: /Host · Policy reviewed/ }))
  expect(view.getByText('Access is fixed · choose another policy in a new session')).toBeTruthy()
  const choice = view.getByRole('menuitem', { name: 'Workspace Write' })
  expect(choice.hasAttribute('disabled')).toBe(true)
  fireEvent.click(choice)
  expect(command).not.toHaveBeenCalled()
})
