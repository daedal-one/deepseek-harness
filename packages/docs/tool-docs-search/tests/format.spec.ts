import { describe, expect, it } from 'vitest'
import {
  LIMIT_MAX,
  QUERY_MAX_CHARS,
  boundSnippet,
  formatDocsSearchResult,
  validateDocsSearchArgs,
} from '../src/format.ts'
import type { DocsSearchResult } from '@deepseek-ai/dsh-docs-search'

const VALID_ARGS = { query: 'session log format' }

/** One hit with every contract field populated, overridable per test. */
function hit(over: Partial<DocsSearchResult> = {}): DocsSearchResult {
  return {
    source: 'readme',
    file: 'README.md',
    anchor: 'setup',
    title: 'Setup',
    snippet: 'Install pnpm dependencies before building.',
    score: 0.5,
    arms: { lexical: 0.5 },
    ...over,
  }
}

describe('validateDocsSearchArgs', () => {
  it('accepts a plain query without optional fields', () => {
    expect(() => { validateDocsSearchArgs(VALID_ARGS, LIMIT_MAX) }).not.toThrow()
  })

  it.each([
    { label: 'empty', query: '' },
    { label: 'whitespace-only', query: '   \n\t ' },
  ])('rejects a $label query', ({ query }) => {
    expect(() => { validateDocsSearchArgs({ query }, LIMIT_MAX) }).toThrow('invalid query: must be a non-empty string')
  })

  it('accepts a query of exactly the maximum length', () => {
    const query = '字'.repeat(QUERY_MAX_CHARS)
    expect(() => { validateDocsSearchArgs({ query }, LIMIT_MAX) }).not.toThrow()
  })

  it('rejects a query one code point over the maximum, counting astral characters once', () => {
    // 513 astral emoji are 1026 UTF-16 code units but 513 code points; the
    // bound must trip on the code-point count, not String.length.
    const query = '🎯'.repeat(513)
    expect(query.length).toBe(1026)
    expect(Array.from(query)).toHaveLength(513)
    expect(() => { validateDocsSearchArgs({ query }, LIMIT_MAX) }).toThrow(`invalid query: must be at most ${QUERY_MAX_CHARS} characters`)
  })

  it.each([
    { limit: 0, message: 'invalid limit: must be between 1 and 50' },
    { limit: 51, message: 'invalid limit: must be between 1 and 50' },
  ])('rejects limit $limit outside the protocol bounds', ({ limit, message }) => {
    expect(() => { validateDocsSearchArgs({ query: 'q', limit }, LIMIT_MAX) }).toThrow(message)
  })

  it('rejects an explicit limit above the deployment cap, naming the cap', () => {
    expect(() => { validateDocsSearchArgs({ query: 'q', limit: 3 }, 2) }).toThrow('invalid limit: exceeds the configured result limit cap (2)')
  })

  it('accepts a limit exactly at the deployment cap', () => {
    expect(() => { validateDocsSearchArgs({ query: 'q', limit: 2 }, 2) }).not.toThrow()
  })

  it('accepts an omitted limit regardless of the cap', () => {
    expect(() => { validateDocsSearchArgs({ query: 'q' }, 1) }).not.toThrow()
  })
})

describe('boundSnippet', () => {
  it('returns a snippet within the budget unchanged', () => {
    expect(boundSnippet('short snippet', 40)).toBe('short snippet')
  })

  it('returns a snippet of exactly the budget length unchanged', () => {
    expect(boundSnippet('abcdefghij', 10)).toBe('abcdefghij')
  })

  it('truncates a longer snippet to the budget with an ellipsis', () => {
    expect(boundSnippet('abcdefghij', 7)).toBe('abcd...')
  })

  it('collapses whitespace runs to single spaces and trims the ends', () => {
    expect(boundSnippet('  a\n\tb   c  ', 40)).toBe('a b c')
  })

  it.each([
    { budget: 1, expected: 'a' },
    { budget: 2, expected: 'ab' },
    { budget: 3, expected: 'abc' },
  ])('truncates to $budget characters without an ellipsis when the budget is too small for one', ({ budget, expected }) => {
    expect(boundSnippet('abcdef', budget)).toBe(expected)
  })

  it('truncates on code points so an astral character is never split', () => {
    // Budget 2 keeps 'a' plus the intact emoji — 3 UTF-16 units but 2 code
    // points; a UTF-16-unit cut would have split the surrogate pair.
    expect(boundSnippet('a🎯b', 2)).toBe('a🎯')
    expect(boundSnippet('a🎯bcd', 5)).toBe('a🎯bcd')
    expect(boundSnippet('a🎯bcdef', 5)).toBe('a🎯...')
  })

  it('keeps CJK text intact at the exact budget', () => {
    expect(boundSnippet('中文片段', 4)).toBe('中文片段')
    expect(boundSnippet('中文片段', 3)).toBe('中文片')
  })
})

describe('formatDocsSearchResult', () => {
  it('renders one locator line plus an indented snippet per hit, then the final line', () => {
    const text = formatDocsSearchResult({
      hits: [
        hit(),
        hit({ source: 'spec', file: '.specs/tasks/x.spec.md', anchor: 'acceptance', title: 'Acceptance', snippet: 'The tool refuses to load without the service.', score: 1, arms: {} }),
      ],
      building: false,
    })
    expect(text).toBe([
      '- Setup — README.md#setup (readme, score 0.50)',
      '  Install pnpm dependencies before building.',
      '- Acceptance — .specs/tasks/x.spec.md#acceptance (spec, score 1.00)',
      '  The tool refuses to load without the service.',
      'Read the file at the anchor for the full text.',
    ].join('\n'))
  })

  it('formats scores with two fraction digits', () => {
    const text = formatDocsSearchResult({ hits: [hit({ score: 0 })], building: false })
    expect(text).toContain('(readme, score 0.00)')
  })

  it('collapses a multiline title and snippet into single render lines', () => {
    const text = formatDocsSearchResult({
      hits: [hit({ title: 'Setup\nguide', snippet: 'line one\nline two' })],
      building: false,
    })
    expect(text).toBe([
      '- Setup guide — README.md#setup (readme, score 0.50)',
      '  line one line two',
      'Read the file at the anchor for the full text.',
    ].join('\n'))
  })

  it('puts the building caveat first when the index was building', () => {
    const text = formatDocsSearchResult({ hits: [hit()], building: true })
    expect(text.startsWith('The documentation index is still building; these results are lexical-only meanwhile.\n')).toBe(true)
    expect(text).toContain('- Setup — README.md#setup (readme, score 0.50)')
    expect(text).toContain('Read the file at the anchor for the full text.')
  })

  it('renders the no-match line without the final line for zero hits', () => {
    expect(formatDocsSearchResult({ hits: [], building: false })).toBe('No documentation matches the query.')
  })

  it('renders the building caveat above the no-match line when nothing hit during a build', () => {
    expect(formatDocsSearchResult({ hits: [], building: true })).toBe([
      'The documentation index is still building; these results are lexical-only meanwhile.',
      'No documentation matches the query.',
    ].join('\n'))
  })
})
