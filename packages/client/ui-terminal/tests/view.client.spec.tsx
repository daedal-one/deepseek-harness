// @vitest-environment jsdom
/** Terminal display replays retained output and forwards interactive viewport events. */
import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalView } from '../src/client/TerminalView.tsx'
import type { TerminalSnapshot } from '../src/client/model.ts'
import { en } from '../src/client/locales.ts'

const f = vi.hoisted(() => ({
  open: vi.fn(), loadAddon: vi.fn(), focus: vi.fn(), reset: vi.fn(), write: vi.fn(), dispose: vi.fn(), fit: vi.fn(),
  dataDispose: vi.fn(), resizeDispose: vi.fn(), observe: vi.fn(), disconnect: vi.fn(),
  options: { disableStdin: false },
  data: undefined as ((data: string) => void) | undefined,
  resize: undefined as ((size: { rows: number; cols: number }) => void) | undefined,
  observer: undefined as (() => void) | undefined,
}))
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  rows = 24
  cols = 80
  options = f.options
  open = f.open
  loadAddon = f.loadAddon
  focus = f.focus
  reset = f.reset
  write = f.write
  dispose = f.dispose
  onData(callback: (data: string) => void) { f.data = callback; return { dispose: f.dataDispose } }
  onResize(callback: (size: { rows: number; cols: number }) => void) { f.resize = callback; return { dispose: f.resizeDispose } }
} }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = f.fit } }))

function setup() {
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { f.observer = callback }
    observe = f.observe
    disconnect = f.disconnect
  })
  let snapshot: TerminalSnapshot = { generation: 1, offset: 0, text: '', status: 'connecting', cwd: '', error: '' }
  const props = { useTerminal: (select: (state: TerminalSnapshot) => unknown) => select(snapshot),
    start: vi.fn(), input: vi.fn(), resize: vi.fn(), restart: vi.fn(async () => {}), scrollback: 20,
    t: makeTranslate(en) } as unknown as ComponentProps<typeof TerminalView>
  return { props, set: (next: Partial<TerminalSnapshot>) => { snapshot = { ...snapshot, ...next } } }
}

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('terminal viewport', () => {
  it('replays only new output, resets for retention gaps and restart, and releases emulator listeners', () => {
    const b = setup()
    const view = render(<TerminalView {...b.props} />)
    expect(screen.getByText(en.connecting)).toBeDefined()
    expect(b.props.start).toHaveBeenCalledWith(24, 80)
    expect(f.options.disableStdin).toBe(true)
    f.data?.('pwd\n')
    f.resize?.({ rows: 30, cols: 90 })
    f.observer?.()
    expect(b.props.input).toHaveBeenCalledWith('pwd\n')
    expect(b.props.resize).toHaveBeenCalledWith(30, 90)
    expect(f.fit).toHaveBeenCalledTimes(2)
    b.set({ status: 'open', cwd: '/session', text: 'hello' })
    view.rerender(<TerminalView {...b.props} />)
    expect(f.write).toHaveBeenLastCalledWith('hello')
    expect(f.options.disableStdin).toBe(false)
    expect(b.props.resize).toHaveBeenCalledWith(24, 80)
    b.set({ text: 'hello world' })
    view.rerender(<TerminalView {...b.props} />)
    expect(f.write).toHaveBeenLastCalledWith(' world')
    b.set({ offset: 20, text: 'retained' })
    view.rerender(<TerminalView {...b.props} />)
    expect(f.reset).toHaveBeenCalledTimes(2)
    expect(f.write).toHaveBeenLastCalledWith('retained')
    expect(screen.getByText(en.truncated)).toBeDefined()
    b.set({ generation: 2, offset: 0, text: '', status: 'closed' })
    view.rerender(<TerminalView {...b.props} />)
    expect(screen.getByText(en.closed)).toBeDefined()
    expect(f.reset).toHaveBeenCalledTimes(3)
    b.set({ status: 'error', error: 'offline' })
    view.rerender(<TerminalView {...b.props} />)
    expect(screen.getByText('Terminal failed: offline')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: en.restart }))
    expect(b.props.restart).toHaveBeenCalledWith(24, 80)
    view.unmount()
    expect(f.disconnect).toHaveBeenCalledOnce()
    expect(f.dataDispose).toHaveBeenCalledOnce()
    expect(f.resizeDispose).toHaveBeenCalledOnce()
    expect(f.dispose).toHaveBeenCalledOnce()
  })
})
