/** Locale-owned terminal tab, controls and status messages. */
export const en = {
  'view': 'Terminal',
  'restart': 'Restart terminal',
  'connecting': 'Connecting to the session environment…',
  'closed': 'Terminal closed',
  'error': 'Terminal failed: {message}',
  'label': 'Session terminal',
  'truncated': 'Earlier terminal output was discarded.',
} as const

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Interactive Session terminal copy. */
    sessionTerminal: keyof typeof en
  }
}
