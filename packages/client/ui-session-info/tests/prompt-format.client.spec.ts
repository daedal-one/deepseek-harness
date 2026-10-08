import { describe, expect, it } from 'vitest'
import type { SessionPromptTool } from '@deepseek-ai/dsh-session-info/types'
import {
  countOccurrences,
  filterTools,
  formatSchema,
  parameterRows,
  promptStats,
} from '../src/client/prompt-format.ts'

/** One tool carrying the given argument schema. */
function tool(name: string, description: string, parameters: SessionPromptTool['parameters']): SessionPromptTool {
  return { name, description, parameters }
}

const BASH = tool('bash', 'Run a shell command.', {
  type: 'object',
  properties: {
    command: { type: 'string', description: 'Command line.' },
    timeoutMs: { type: 'number' },
    mode: { type: ['string', 'null'] },
    opaque: 'not-a-schema',
    anything: null,
  },
  required: ['command', 7],
})

const READ = tool('read', 'Read one file.', { type: 'object', properties: {} })

describe('parameterRows', () => {
  it('flattens declared properties with their type, required flag, and description', () => {
    expect(parameterRows(BASH.parameters)).toEqual([
      { name: 'command', type: 'string', required: true, description: 'Command line.' },
      { name: 'timeoutMs', type: 'number', required: false, description: null },
      { name: 'mode', type: 'string | null', required: false, description: null },
      { name: 'opaque', type: null, required: false, description: null },
      { name: 'anything', type: null, required: false, description: null },
    ])
  })

  it('reports no rows for a schema that declares no object properties', () => {
    expect(parameterRows(READ.parameters)).toEqual([])
    expect(parameterRows({ type: 'object' })).toEqual([])
    expect(parameterRows({ properties: [] })).toEqual([])
  })

  it('reports no rows for a schema that is not a JSON object', () => {
    expect(parameterRows('opaque')).toEqual([])
    expect(parameterRows(null)).toEqual([])
    expect(parameterRows([])).toEqual([])
  })

  it('ignores a required declaration that is not a list of names', () => {
    expect(parameterRows({ properties: { flag: { type: 'boolean' } }, required: 'flag' }))
      .toEqual([{ name: 'flag', type: 'boolean', required: false, description: null }])
  })

  it('declares no type for a union that names none and for a non-list type', () => {
    expect(parameterRows({ properties: { any: { type: [1, 2] } } }))
      .toEqual([{ name: 'any', type: null, required: false, description: null }])
    expect(parameterRows({ properties: { weird: { type: 5 } } }))
      .toEqual([{ name: 'weird', type: null, required: false, description: null }])
  })

  it('declares no description for a property that carries a non-string one', () => {
    expect(parameterRows({ properties: { count: { type: 'integer', description: 3 } } }))
      .toEqual([{ name: 'count', type: 'integer', required: false, description: null }])
  })
})

describe('filterTools', () => {
  const tools = [BASH, READ]

  it('returns the catalog unchanged for an empty or whitespace-only query', () => {
    expect(filterTools(tools, '')).toBe(tools)
    expect(filterTools(tools, '   ')).toBe(tools)
  })

  it('matches a tool by name, description, or declared parameter', () => {
    expect(filterTools(tools, 'BASH')).toEqual([BASH])
    expect(filterTools(tools, 'one file')).toEqual([READ])
    expect(filterTools(tools, 'timeoutms')).toEqual([BASH])
  })

  it('returns no tool when the query matches nothing', () => {
    expect(filterTools(tools, 'nonexistent')).toEqual([])
  })
})

describe('countOccurrences', () => {
  it('counts non-overlapping case-insensitive occurrences', () => {
    expect(countOccurrences('Alpha alpha ALPHA', 'alpha')).toBe(3)
    expect(countOccurrences('aaaa', 'aa')).toBe(2)
  })

  it('reports zero for an empty query and for text without the query', () => {
    expect(countOccurrences('anything', '  ')).toBe(0)
    expect(countOccurrences('anything', 'missing')).toBe(0)
  })
})

describe('promptStats', () => {
  it('counts the characters and lines of a rendered prompt', () => {
    expect(promptStats('a\nb')).toEqual({ lines: 2, characters: 3 })
    expect(promptStats('single')).toEqual({ lines: 1, characters: 6 })
  })

  it('reports no lines for an empty prompt', () => {
    expect(promptStats('')).toEqual({ lines: 0, characters: 0 })
  })
})

describe('formatSchema', () => {
  it('pretty-prints the argument schema as indented JSON', () => {
    expect(formatSchema({ type: 'object', properties: {} })).toBe('{\n  "type": "object",\n  "properties": {}\n}')
  })
})
