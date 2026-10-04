/** xterm presentation over a framework-bound Session terminal projection. */

import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { TerminalSnapshot } from './model.ts'
import '@xterm/xterm/css/xterm.css'
import css from './terminal.module.css'

/** Callbacks and renderer-owned snapshot hook for one Session terminal. */
export interface TerminalInjected {
  hooks: { terminal: ObservableSnapshot<TerminalSnapshot> }
  start(rows: number, cols: number): void
  input(data: string): void
  resize(rows: number, cols: number): void
  restart(rows: number, cols: number): Promise<void>
  scrollback: number
}

type Props = ConvViewProps & InjectFace<TerminalInjected> & PropsLocale<'sessionTerminal'>

/**
 * Render an interactive terminal; unmounting leaves its connection-owned shell alive.
 * @param props - terminal commands, snapshot hook and localized copy.
 * @returns terminal viewport and restart control.
 */
export function TerminalView({ useTerminal, start, input, resize, restart, scrollback, t }: Props) {
  const snapshot = useTerminal(value => value)
  const container = useRef<HTMLDivElement>(null)
  const emulator = useRef<Terminal>()
  const cursor = useRef({ generation: -1, offset: 0 })
  // The viewport mounts unconditionally; setup precedes both projection effects.
  useEffect(() => {
    const viewport = container.current as HTMLDivElement
    const terminal = new Terminal({ cursorBlink: true, scrollback, fontSize: 14 })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(viewport)
    emulator.current = terminal
    cursor.current = { generation: -1, offset: 0 }
    fit.fit()
    start(terminal.rows, terminal.cols)
    const data = terminal.onData(input)
    const resized = terminal.onResize((size) => { resize(size.rows, size.cols) })
    const observer = new ResizeObserver(() => { fit.fit() })
    observer.observe(viewport)
    terminal.focus()
    return () => {
      observer.disconnect()
      data.dispose()
      resized.dispose()
      emulator.current = undefined
      terminal.dispose()
    }
  }, [start, input, resize, scrollback])
  useEffect(() => {
    const terminal = emulator.current as Terminal
    if (cursor.current.generation !== snapshot.generation || cursor.current.offset < snapshot.offset) {
      terminal.reset()
      cursor.current = { generation: snapshot.generation, offset: snapshot.offset }
    }
    const data = snapshot.text.slice(cursor.current.offset - snapshot.offset)
    if (data !== '') terminal.write(data)
    cursor.current.offset = snapshot.offset + snapshot.text.length
    terminal.options.disableStdin = snapshot.status !== 'open'
  }, [snapshot])
  useEffect(() => {
    if (snapshot.status === 'open') {
      const terminal = emulator.current as Terminal
      resize(terminal.rows, terminal.cols)
    }
  }, [snapshot.status, resize])
  return <div className={css.root} data-conversation-composer-overlay="">
    <div className={css.toolbar} data-session-terminal-controls>
      <span>{snapshot.status === 'connecting' ? t('connecting')
        : snapshot.status === 'error' ? t('error', { message: snapshot.error })
          : snapshot.status === 'closed' ? t('closed') : snapshot.cwd}</span>
      <button type="button" onClick={() => {
        const terminal = emulator.current as Terminal
        void restart(terminal.rows, terminal.cols)
      }}>
        {t('restart')}
      </button>
    </div>
    {snapshot.offset > 0 && <div>{t('truncated')}</div>}
    <div className={css.viewport} ref={container} aria-label={t('label')} />
  </div>
}
