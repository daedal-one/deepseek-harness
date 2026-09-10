/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof en

/** English copy for this feature. */
export const en = {
  'session.new': 'New Session',
  'session.new.label': 'New session',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
  'panels.label': 'Global panels',
} satisfies Record<string, string>
