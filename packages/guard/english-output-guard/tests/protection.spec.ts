import { describe, expect, it } from 'vitest'
import { hasSubstantialHan, protectText, restoreText } from '../src/protection.ts'

describe('English output protection', () => {
  it('applies both configured Han thresholds', () => {
    expect(hasSubstantialHan('中文 answer', 2, 0.2)).toBe(true)
    expect(hasSubstantialHan('中 answer', 2, 0.1)).toBe(false)
    expect(hasSubstantialHan('中文 very long English answer', 2, 0.5)).toBe(false)
  })

  it('excludes code, link destinations, URLs, paths, flags, and identifiers from detection', () => {
    const input = 'Keep `中文()` and ```ts\nconst 中文 = 1\n``` at [docs](https://例子.test/中文), /tmp/中文, --name=中文 and API_KEY.'
    const protectedText = protectText(input)
    expect(hasSubstantialHan(protectedText.text, 1, 0.01)).toBe(false)
    expect(restoreText(protectedText.text, protectedText.spans)).toBe(input)
  })

  it('requires every placeholder exactly once', () => {
    const protectedText = protectText('Use `/tmp/a` and https://example.test/a.')
    expect(protectedText.spans).toHaveLength(2)
    expect(restoreText(protectedText.text.replace(protectedText.spans[0]!.placeholder, ''), protectedText.spans)).toBeUndefined()
    expect(restoreText(`${protectedText.text} ${protectedText.spans[0]!.placeholder}`, protectedText.spans)).toBeUndefined()
  })
})
