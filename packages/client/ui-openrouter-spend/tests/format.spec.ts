import { describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en } from '../src/client/locales.ts'
import { formatUsd, formatUsdOptional } from '../src/client/format.ts'

const t = makeTranslate(en)

describe('formatUsd', () => {
  it('renders two fraction digits on a whole-dollar value', () => {
    expect(formatUsd(t, 42)).toBe('42.00 USD')
  })

  it('keeps sub-dollar precision up to four digits', () => {
    expect(formatUsd(t, 0.03)).toBe('0.03 USD')
    expect(formatUsd(t, 0.375)).toBe('0.375 USD')
    expect(formatUsd(t, 3.125)).toBe('3.125 USD')
  })

  it('rounds beyond four digits', () => {
    expect(formatUsd(t, 1.23456)).toBe('1.2346 USD')
  })
})

describe('formatUsdOptional', () => {
  it('renders the no-limit wording instead of a zero amount for null', () => {
    expect(formatUsdOptional(t, null)).toBe(en['money.none'])
  })

  it('formats a present amount through the shared unit template', () => {
    expect(formatUsdOptional(t, 42.5)).toBe('42.50 USD')
    expect(formatUsdOptional(t, 0)).toBe('0.00 USD')
  })
})
