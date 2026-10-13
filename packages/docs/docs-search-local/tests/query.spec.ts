/**
 * Query normalization, FTS5 sanitization, snippet bounding, kind filtering,
 * and Reciprocal Rank Fusion.
 */

import { describe, expect, it } from 'vitest'
import {
  DOCS_SEARCH_RRF_K,
  DocsSearchError,
  filterKinds,
  fuseRanks,
  makeSnippet,
  normalizeLimit,
  normalizeQuery,
  sanitizeFtsQuery,
  toResults,
} from '../src/query.ts'
import type { ChunkMetadata } from '../src/store.ts'

describe('FTS5 sanitization', () => {
  it('emits one quoted phrase per token so query syntax stays inert', () => {
    expect(sanitizeFtsQuery('hybrid search')).toBe('"hybrid" OR "search"')
  })

  it('strips every FTS5 operator and keyword spelling from caller input', () => {
    const hostile = 'docs* AND (search OR "index") NOT ^prefix -negated col:value'
    const expression = sanitizeFtsQuery(hostile)
    expect(expression).toBe('"docs" OR "and" OR "search" OR "or" OR "index" OR "not" OR "prefix" OR "negated" OR "col" OR "value"')
    // No operator can reach FTS5: every emitted term is inside quotes.
    for (const term of expression.split(' OR ')) {
      expect(term.startsWith('"') && term.endsWith('"')).toBe(true)
    }
  })

  it('is empty when the query carries no letter or digit', () => {
    expect(sanitizeFtsQuery('*** "": -')).toBe('')
    expect(sanitizeFtsQuery('   ')).toBe('')
  })

  it('lowercases and keeps Unicode letters and digits', () => {
    expect(sanitizeFtsQuery('Café 42')).toBe('"café" OR "42"')
  })
})

describe('query and limit normalization', () => {
  it('folds whitespace', () => {
    expect(normalizeQuery('  hybrid \n search  ')).toBe('hybrid search')
  })

  it('rejects a query with no searchable token', () => {
    expect(() => normalizeQuery('   ')).toThrow(DocsSearchError)
    expect(() => normalizeQuery('***')).toThrow(/must contain letters or digits/)
  })

  it('rejects an out-of-range limit and accepts a defaulted one', () => {
    expect(normalizeLimit(undefined, 8, 50)).toBe(8)
    expect(normalizeLimit(50, 8, 50)).toBe(50)
    expect(() => normalizeLimit(51, 8, 50)).toThrow(/between 1 and 50/)
    expect(() => normalizeLimit(0, 8, 50)).toThrow(DocsSearchError)
    expect(() => normalizeLimit(1.5, 8, 50)).toThrow(DocsSearchError)
  })
})

describe('kind filtering', () => {
  it('maps `all` and an omitted kind to every corpus kind', () => {
    expect(filterKinds(undefined)).toEqual([])
    expect(filterKinds('all')).toEqual([])
  })

  it('maps a specific kind to itself', () => {
    expect(filterKinds('note')).toEqual(['note'])
    expect(filterKinds('subsystem')).toEqual(['subsystem'])
  })

  it('rejects a kind outside the corpus vocabulary', () => {
    expect(() => filterKinds('blog')).toThrow(DocsSearchError)
  })
})

describe('Reciprocal Rank Fusion', () => {
  it('sums reciprocal ranks so both arms contribute', () => {
    const fused = fuseRanks(
      [{ id: 3, score: -1 }, { id: 1, score: -2 }],
      [{ id: 1, score: 0.9 }, { id: 4, score: 0.5 }],
      3,
    )
    // Id 1 is ranked by both arms and therefore leads; ids 3 and 4 are ranked
    // by one arm each and keep their arm-native score.
    expect(fused.map(candidate => candidate.id)).toEqual([1, 3, 4])
    expect(fused[0]!.score).toBe(1 / (DOCS_SEARCH_RRF_K + 2) + 1 / (DOCS_SEARCH_RRF_K + 1))
    expect(fused[0]!.arms).toEqual({ lexical: -2, semantic: 0.9 })
    expect(fused[1]!.arms).toEqual({ lexical: -1 })
    expect(fused[2]!.arms).toEqual({ semantic: 0.5 })
  })

  it('keeps a lexical-only match when nothing is semantic', () => {
    const fused = fuseRanks([{ id: 9, score: -4 }], [], 5)
    expect(fused).toEqual([{ id: 9, score: 1 / (DOCS_SEARCH_RRF_K + 1), arms: { lexical: -4 } }])
  })

  it('ranks a semantic-only match when nothing is lexical', () => {
    const fused = fuseRanks([], [{ id: 11, score: 0.7 }], 5)
    expect(fused).toEqual([{ id: 11, score: 1 / (DOCS_SEARCH_RRF_K + 1), arms: { semantic: 0.7 } }])
  })

  it('breaks a score tie on ascending chunk id so results are stable', () => {
    const fused = fuseRanks([{ id: 5, score: -1 }], [{ id: 2, score: 0.5 }], 5)
    expect(fused.map(candidate => candidate.id)).toEqual([2, 5])
  })

  it('truncates to the requested limit', () => {
    const fused = fuseRanks([{ id: 1, score: -1 }, { id: 2, score: -2 }, { id: 3, score: -3 }], [], 2)
    expect(fused.map(candidate => candidate.id)).toEqual([1, 2])
  })
})

describe('snippets', () => {
  it('returns a body shorter than the budget unchanged, with whitespace folded', () => {
    expect(makeSnippet('one\ttwo   three', 240)).toBe('one two three')
  })

  it('bounds a long body to the budget in code points', () => {
    const snippet = makeSnippet('word '.repeat(100), 40)
    expect(Array.from(snippet).length).toBeLessThanOrEqual(40)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet).not.toMatch(/\s…$/u)
  })

  it('counts astral characters as one code point each', () => {
    const snippet = makeSnippet('😀'.repeat(50), 10)
    expect(Array.from(snippet)).toHaveLength(10)
  })

  it('cuts mid-word when no boundary falls near the budget', () => {
    const snippet = makeSnippet('x'.repeat(100), 10)
    expect(snippet).toBe(`${'x'.repeat(9)}…`)
  })
})

describe('result projection', () => {
  const metadata: ChunkMetadata[] = [{
    id: 1,
    kind: 'subsystem',
    file: 'docs/subsystems/session-query.md',
    anchor: 'logical-records',
    title: 'Logical records',
    body: 'Record prose that is long enough to be excerpted by a small budget.',
  }]

  it('projects fused candidates into located results', () => {
    const results = toResults(metadata, [{ id: 1, score: 0.5, arms: { lexical: -1 } }], 20)
    expect(results).toEqual([{
      source: 'subsystem',
      file: 'docs/subsystems/session-query.md',
      anchor: 'logical-records',
      title: 'Logical records',
      snippet: 'Record prose that…',
      score: 0.5,
      arms: { lexical: -1 },
    }])
  })

  it('drops a candidate whose metadata row is gone', () => {
    expect(toResults(metadata, [{ id: 99, score: 0.5, arms: {} }], 20)).toEqual([])
  })
})
