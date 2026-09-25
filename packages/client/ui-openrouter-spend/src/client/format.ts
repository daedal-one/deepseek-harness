/** Shared money formatting for the Spend view. */

import type { SpendKey } from './locales.ts'

/**
 * Deterministic USD precision for every spend row: two decimal digits on a
 * whole-dollar value, up to four sub-dollar digits otherwise (a 0.00005 USD
 * reading stays distinguishable from a zero reading).
 */
const USD = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})

/**
 * Format one USD amount through the locale-owned `'money.usd'` template.
 * @param t - the view's translate seat (the `'spend'` namespace).
 * @param value - amount in USD.
 * @returns the localized amount string.
 */
export function formatUsd(t: (key: SpendKey, params?: Record<string, unknown>) => string, value: number): string {
  return t('money.usd', { amount: USD.format(value) })
}

/**
 * Format a USD amount that may be absent. `null` renders the locale-owned
 * "no limit" wording rather than a zero amount.
 * @param t - the view's translate seat (the `'spend'` namespace).
 * @param value - amount in USD, or null when the reading carries no value.
 * @returns the localized amount string or the no-limit wording.
 */
export function formatUsdOptional(
  t: (key: SpendKey, params?: Record<string, unknown>) => string,
  value: number | null,
): string {
  return value === null ? t('money.none') : formatUsd(t, value)
}
