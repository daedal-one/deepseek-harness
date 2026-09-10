/** The command namespace key union. */
export type CommandKey = keyof typeof en

/** English copy for this feature. */
export const en = {
  'description.compact': 'Compact older conversation history',
  'description.export': 'Download this Session log as a ZIP archive',
  'description.feedback': 'record feedback about this session',
  'description.goal': 'set or view the goal for a long-running task',
  'description.permission': 'Switch the permission preset (sandbox mode + approval policy)',
  'description.plan': 'Enter or leave plan mode',
  'search.placeholder': 'Search…',
  'search.aria': 'Filter options',
  'status.loading': 'Loading options…',
  'status.applying': 'Applying…',
  'status.empty': 'No options',
  'overlay.aria': '/{command} options',
  'listbox.aria': '/{command} matches',
  'notice.attachmentsUnsupported': '/{command} does not accept attachments; remove them first',
} satisfies Record<string, string>
