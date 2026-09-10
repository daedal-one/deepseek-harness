// @vitest-environment jsdom
/**
 * FeedbackDialog rendering: the modal shows the seven category chips, the
 * detail box, and the hint while a target is open; a chip toggles the
 * category through the injected verb; Submit routes to the controller and
 * stays enabled with an empty draft; a failure code renders its copy; and the
 * acknowledgement toast mounts from the toast sequence and retires through
 * dismissToast once its fade completes.
 */
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonCopy } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { FEEDBACK_CATEGORIES } from '@deepseek-ai/dsh-command-feedback'
import { FeedbackDialog } from '../src/client/FeedbackDialog.tsx'
import type { FeedbackDialogState } from '../src/client/dialog.ts'
import { en, en as copy } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(copy, commonCopy)

/** Render the entry over a fixed state and recording verbs. */
function mount(overrides: Partial<FeedbackDialogState> = {}) {
  const state: FeedbackDialogState = {
    target: { kind: 'session' }, category: null, text: '', submitting: false, failure: null, toast: 0,
    ...overrides,
  }
  const verbs = {
    edit: vi.fn(),
    submit: vi.fn(() => Promise.resolve()),
    dismiss: vi.fn(),
    dismissToast: vi.fn(),
  }
  const useDialog = (<T,>(select: (v: FeedbackDialogState) => T): T =>
    useSyncExternalStore(() => () => {}, () => select(state))) as never
  const props = { useDialog, ...verbs, t } as unknown as Parameters<typeof FeedbackDialog>[0]
  return { ...render(<FeedbackDialog {...props} />), ...verbs }
}

describe('FeedbackDialog', () => {
  it('discloses conversation-log inclusion in both supported locales', () => {
    expect(copy['dialog.hint']).toBe('Add details to help us improve. Your submission will include the current conversation log.')
    expect(en['dialog.hint']).toBe('Add details to help us improve. Your submission will include the current conversation log.')
  })

  it('renders nothing but the probe while closed with no toast', () => {
    const ui = mount({ target: null })

    expect(ui.queryByRole('dialog')).toBeNull()
    expect(ui.queryByRole('alert')).toBeNull()
  })

  it('shows every category, the detail box with the hint, and an enabled Submit for an empty draft', () => {
    const ui = mount()

    const dialog = ui.getByRole('dialog', { name: copy['dialog.title'] })
    expect(dialog).toBeTruthy()
    const chips = ui.getByRole('group', { name: copy['dialog.categories'] }).querySelectorAll('button')
    expect([...chips].map(chip => chip.textContent)).toEqual(
      FEEDBACK_CATEGORIES.map(category => copy[`category.${category}`]),
    )
    expect(ui.getByLabelText(copy['dialog.detail']).getAttribute('placeholder')).toBe(copy['dialog.hint'])
    expect(ui.getByRole('button', { name: commonCopy.submit }).hasAttribute('disabled')).toBe(false)
  })

  it('selects a chip, and clears it when the selected chip is clicked again', () => {
    const ui = mount({ category: 'task-result' })

    const chips = ui.getByRole('group', { name: copy['dialog.categories'] }).querySelectorAll('button')
    expect(chips[0]?.getAttribute('aria-pressed')).toBe('true')
    expect(chips[1]?.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(chips[1]!)
    expect(ui.edit).toHaveBeenLastCalledWith({ category: 'instruction-following' })
    fireEvent.click(chips[0]!)
    expect(ui.edit).toHaveBeenLastCalledWith({ category: null })
  })

  it('forwards typing, submits, and closes through the injected verbs', () => {
    const ui = mount({ text: 'draft' })

    fireEvent.change(ui.getByLabelText(copy['dialog.detail']), { target: { value: 'draft more' } })
    expect(ui.edit).toHaveBeenCalledWith({ text: 'draft more' })

    fireEvent.click(ui.getByRole('button', { name: commonCopy.submit }))
    expect(ui.submit).toHaveBeenCalledTimes(1)

    fireEvent.click(ui.getByRole('button', { name: commonCopy.close }))
    expect(ui.dismiss).toHaveBeenCalledTimes(1)
  })

  it('disables Submit and the chips while a submission is in flight', () => {
    const ui = mount({ submitting: true })

    expect(ui.getByRole('button', { name: commonCopy.submitting }).hasAttribute('disabled')).toBe(true)
    const chips = ui.getByRole('group', { name: copy['dialog.categories'] }).querySelectorAll('button')
    expect([...chips].every(chip => chip.hasAttribute('disabled'))).toBe(true)
  })

  it('renders the conflict and size copy for their codes and the generic copy otherwise', () => {
    const conflict = mount({ failure: 'version-conflict' })
    expect(conflict.getByRole('status').textContent).toBe(copy['error.conflict'])
    cleanup()

    const oversized = mount({ failure: 'note-too-large' })
    expect(oversized.getByRole('status').textContent).toBe(copy['error.noteTooLarge'])
    cleanup()

    const other = mount({ failure: 'session-not-found' })
    expect(other.getByRole('status').textContent).toBe(copy['error.generic'])
  })

  it('retires the toast when the entry unmounts, so a Session switch does not replay it', () => {
    const ui = mount({ target: null, toast: 3 })

    ui.unmount()

    expect(ui.dismissToast).toHaveBeenCalledWith(3)
  })

  it('shows the acknowledgement toast and retires it after the fade', () => {
    vi.useFakeTimers()
    try {
      const ui = mount({ target: null, toast: 3 })

      expect(ui.getByRole('alert').textContent).toBe(copy['toast.recorded'])
      act(() => { vi.advanceTimersByTime(4000) })
      expect(ui.dismissToast).toHaveBeenCalledWith(3)
    } finally {
      vi.useRealTimers()
    }
  })
})
