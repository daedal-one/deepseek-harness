/**
 * Pure presentation helpers for the Prompt view: the argument-schema rows of
 * one tool, the searchable tool filter, prompt match counting, and prompt
 * figures. Nothing here reads copy — a value the dictionary owns, such as the
 * wording for an undeclared type, stays a null for the view to translate.
 */

import type { SessionPromptTool } from '@deepseek-ai/dsh-session-info/types'

/** One tool's argument schema exactly as the Host logged it. */
type PromptSchema = SessionPromptTool['parameters']

/** One top-level parameter of a tool's argument schema. */
export interface PromptParameterRow {
  /** Property name as declared by the schema. */
  readonly name: string
  /** Declared JSON Schema type, joined for a union, or null when undeclared. */
  readonly type: string | null
  /** Whether the schema lists this property as required. */
  readonly required: boolean
  /** Declared property description, or null when the schema carries none. */
  readonly description: string | null
}

/** Line and character figures of one rendered prompt. */
export interface PromptStats {
  /** Rendered line count; 0 for an empty prompt. */
  readonly lines: number
  /** Rendered character count. */
  readonly characters: number
}

/** Whether a JSON value is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * JSON Schema type names of one property schema.
 * @param schema - the property's schema, or an unexpected value.
 * @returns the single declared type, a `' | '`-joined union of declared names,
 *   or null when the schema declares no usable type.
 */
function propertyType(schema: unknown): string | null {
  if (!isRecord(schema)) return null
  const type = schema['type']
  if (typeof type === 'string') return type
  if (!Array.isArray(type)) return null
  const names = type.filter((entry): entry is string => typeof entry === 'string')
  return names.length === 0 ? null : names.join(' | ')
}

/**
 * Flatten a tool's argument schema into its top-level parameter rows.
 * @param schema - the tool's `parameters` JSON Schema object.
 * @returns one row per declared property, in declaration order; empty when the
 *   schema declares no object properties.
 */
export function parameterRows(schema: PromptSchema): readonly PromptParameterRow[] {
  if (!isRecord(schema)) return []
  const properties = schema['properties']
  if (!isRecord(properties)) return []
  const declaredRequired = schema['required']
  const required = new Set(Array.isArray(declaredRequired)
    ? declaredRequired.filter((entry): entry is string => typeof entry === 'string')
    : [])
  return Object.entries(properties).map(([name, property]) => ({
    name,
    type: propertyType(property),
    required: required.has(name),
    description: isRecord(property) && typeof property['description'] === 'string'
      ? property['description']
      : null,
  }))
}

/** One tool's searchable text: its name, description, and serialized schema. */
function searchText(tool: SessionPromptTool): string {
  return `${tool.name}\n${tool.description}\n${JSON.stringify(tool.parameters)}`.toLowerCase()
}

/**
 * Filter the tool catalog by a free-text query.
 * @param tools - the catalog in canonical order.
 * @param query - raw query text; surrounding whitespace is ignored, case does not matter.
 * @returns the matching tools, or the unchanged catalog for an empty query.
 */
export function filterTools(tools: readonly SessionPromptTool[], query: string): readonly SessionPromptTool[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return tools
  return tools.filter(tool => searchText(tool).includes(needle))
}

/**
 * Count non-overlapping case-insensitive occurrences of a query in one text.
 * @param text - the text to search.
 * @param query - raw query text; surrounding whitespace is ignored.
 * @returns the occurrence count; 0 for an empty query.
 */
export function countOccurrences(text: string, query: string): number {
  const needle = query.trim().toLowerCase()
  if (needle === '') return 0
  const haystack = text.toLowerCase()
  let count = 0
  let from = haystack.indexOf(needle)
  while (from >= 0) {
    count += 1
    from = haystack.indexOf(needle, from + needle.length)
  }
  return count
}

/**
 * Compute one prompt's line and character figures.
 * @param text - the rendered prompt.
 * @returns the figures the view states beside the prompt heading.
 */
export function promptStats(text: string): PromptStats {
  return { lines: text === '' ? 0 : text.split('\n').length, characters: text.length }
}

/**
 * Pretty-print one tool's argument schema.
 * @param schema - the tool's `parameters` JSON Schema object.
 * @returns indented JSON text.
 */
export function formatSchema(schema: PromptSchema): string {
  return JSON.stringify(schema, null, 2)
}
