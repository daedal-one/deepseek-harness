/** zh base dictionary for the common namespace: cross-feature standard words. */
export const zh = {
  'ok': 'OK',
  'cancel': 'Cancel',
  'close': 'Close',
  'copy': 'Copy',
  'copied': 'Copied',
  'retry': 'Retry',
  'loading': 'Loading…',
  'load.failed': 'Load failed',
  'submit': 'Submit',
  'submitting': 'Submitting…',
  'next': 'Next',
  'previous': 'Previous',
  'skip': 'Skip',
  'delete': 'Delete',
  'edit': 'Edit',
  'save': 'Save',
  'search': 'Search',
  'more': 'More',
  'collapse': 'Collapse',
  'expand': 'Expand',
  'back': 'Back',
  'unknown': 'Unknown',
  'none': 'None',
  'truncated': 'Truncated',
} satisfies Record<string, string>

/** The common vocabulary key union (zh is the key-set source of truth). */
export type CommonKey = keyof typeof zh
