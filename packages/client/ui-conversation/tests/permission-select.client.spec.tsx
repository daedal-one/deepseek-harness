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
  const trigger = view.getByRole('button', { name: 'Access mode, current: Container · Workspace Write' })
  fireEvent.click(trigger)
  expect(view.getByText('Runs in a container · this policy cannot grant host access')).toBeTruthy()
  expect(view.getByText('Profile default')).toBeTruthy()
  fireEvent.click(view.getByRole('menuitem', { name: 'Policy reviewed' }))
  expect(command).toHaveBeenCalledWith('/permission policy-reviewed')
})

it('uses locale fallbacks for built-ins and keeps host descriptions authoritative', () => {
  const hostDescription = 'May change project files selected by the host.'
  const view = render(<PermissionSelect value={{
    options: [
      { value: 'read-only', name: 'read-only' },
      { value: 'workspace-write', name: 'workspace-write', description: hostDescription },
      { value: 'danger-full-access', name: 'danger-full-access' },
    ],
    currentValue: 'read-only',
    context: { environment: 'host', defaultPreset: 'read-only' },
  }} locked={false} command={async () => true} t={t} />)
  const trigger = view.getByRole('button', { name: 'Access mode, current: Host · Read Only' })
  expect(trigger.hasAttribute('title')).toBe(false)
  fireEvent.focus(trigger)
  expect(view.getByRole('tooltip').textContent)
    .toBe('Inspect files and run commands without changing files. Actions that need write access ask for approval.')
  fireEvent.blur(trigger)
  fireEvent.click(trigger)

  const readOnly = view.getByRole('menuitem', { name: 'Read Only' })
  fireEvent.focus(readOnly)
  expect(view.getByRole('tooltip').textContent)
    .toBe('Inspect files and run commands without changing files. Actions that need write access ask for approval.')
  fireEvent.blur(readOnly)

  const workspaceWrite = view.getByRole('menuitem', { name: 'Workspace Write' })
  fireEvent.focus(workspaceWrite)
  expect(view.getByRole('tooltip').textContent).toBe(hostDescription)
  fireEvent.blur(workspaceWrite)

  const fullAccess = view.getByRole('menuitem', { name: 'Full access' })
  fireEvent.focus(fullAccess)
  expect(view.getByRole('tooltip').textContent)
    .toBe('Read, edit, and run commands within the displayed environment without routine approval. This policy does not grant access beyond that environment. Use only for trusted tasks.')
  fireEvent.blur(fullAccess)
  expect(view.queryByRole('tooltip')).toBeNull()
})

it('lets an existing session explain its access without offering a switch', () => {
  const command = vi.fn(async () => true)
  const view = render(<PermissionSelect value={{ options, currentValue: 'policy-reviewed', canChange: false,
    context: { environment: 'host', defaultPreset: 'workspace-write' } }} locked={false} command={command} t={t} />)
  fireEvent.click(view.getByRole('button', { name: 'Access mode, current: Host · Policy reviewed' }))
  expect(view.getByText('Access is fixed · choose another policy in a new session')).toBeTruthy()
  const choices = view.getAllByRole('menuitem') as HTMLButtonElement[]
  expect(choices.every(choice => choice.disabled)).toBe(true)
  fireEvent.click(view.getByRole('menuitem', { name: 'Workspace Write' }))
  expect(command).not.toHaveBeenCalled()
})
