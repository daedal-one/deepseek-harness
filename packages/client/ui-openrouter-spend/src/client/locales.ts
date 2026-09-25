/** `spend` namespace dictionaries for the Spend conversation view. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'spend'

/** English copy for this feature. */
export const en = {
  'view.spend': 'Spend',
  'heading.key': 'OpenRouter key',
  'row.total': 'Total spend',
  'row.daily': 'Daily spend',
  'row.weekly': 'Weekly spend',
  'row.monthly': 'Monthly spend',
  'row.limit': 'Limit remaining',
  'tag.freeTier': 'Free tier',
  'heading.session': 'This session',
  'session.unpriceable': 'The routed model has no OpenRouter catalog price, so the session cost cannot be estimated.',
  'state.loading': 'Reading spend…',
  'action.refresh': 'Refresh',
  'detail.fetchedAt': 'Read at {time}',
  'failure.not-configured': 'No OpenRouter key is configured on the Host.',
  'failure.unauthorized': 'The OpenRouter API rejected the key.',
  'failure.rate-limited': 'The OpenRouter API rate-limited the request.',
  'failure.unreachable': 'The OpenRouter API could not be reached.',
  'failure.malformed-response': 'The OpenRouter API returned an unexpected response.',
  'money.usd': '{amount} USD',
  'money.none': 'No limit set',
} satisfies Record<string, string>

/** Typed copy keys for this feature. */
export type SpendKey = keyof typeof en
