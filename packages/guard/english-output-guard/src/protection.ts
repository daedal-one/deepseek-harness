/** Protected-span tokenization and Han-script detection for prose translation. */

/** One byte-exact span removed before a translator sees prose. */
export interface ProtectedSpan {
  readonly placeholder: string
  readonly value: string
}

/** Tokenized prose and the spans required to restore it. */
export interface ProtectedText {
  readonly text: string
  readonly spans: readonly ProtectedSpan[]
}

const HAN = /\p{Script=Han}/u
const COUNTABLE = /[\p{L}\p{N}]/u

/* Ordered longest/most-structured first; replacements never rescan placeholders. */
const PROTECTED = new RegExp([
  '```[\\s\\S]*?```',
  String.raw`~~~[\s\S]*?~~~`,
  '`[^`\\n]+`',
  String.raw`(?<=\]\()[^\s)]+(?=\))`,
  String.raw`https?:\/\/[^\s<>)]+(?<![.,;:!?])`,
  String.raw`(?:[A-Za-z]:\\|\/|\.\.?\/)[\p{L}\p{N}_.@+~%#=,:;!$&'()*\-/\\]+`,
  String.raw`--?[A-Za-z][\w-]*(?:=[^\s]+)?`,
  String.raw`\b[A-Z][A-Z0-9_]{2,}\b`,
  String.raw`\b[\w.-]+::[\w.:/-]+\b`,
].join('|'), 'gu')

/**
 * Replace code, destinations, URLs, paths, flags, and identifier-like spans
 * with collision-free placeholders.
 * @param input - prose that may contain structured spans.
 * @returns tokenized text plus byte-exact restoration entries.
 */
export function protectText(input: string): ProtectedText {
  const spans: ProtectedSpan[] = []
  let nonce = 0
  const fresh = (): string => {
    let candidate: string
    do candidate = `__DSH_PROTECTED_${nonce++}__`
    while (input.includes(candidate))
    return candidate
  }
  const text = input.replace(PROTECTED, (value) => {
    const placeholder = fresh()
    spans.push({ placeholder, value })
    return placeholder
  })
  return { text, spans }
}

/**
 * Restore every protected span after requiring each placeholder exactly once.
 * @param translated - translator-produced tokenized prose.
 * @param spans - original protected spans.
 * @returns restored prose, or undefined on missing/duplicate placeholders.
 */
export function restoreText(translated: string, spans: readonly ProtectedSpan[]): string | undefined {
  let restored = translated
  for (const { placeholder, value } of spans) {
    const first = restored.indexOf(placeholder)
    if (first < 0 || restored.indexOf(placeholder, first + placeholder.length) >= 0) return undefined
    restored = `${restored.slice(0, first)}${value}${restored.slice(first + placeholder.length)}`
  }
  return /__DSH_PROTECTED_\d+__/.test(restored) ? undefined : restored
}

/**
 * Decide whether unprotected prose contains enough Han script to enforce.
 * @param input - tokenized prose.
 * @param minimum - minimum Han code points.
 * @param ratio - minimum Han share among letters and digits, from 0 through 1.
 * @returns whether both configured thresholds are met.
 */
export function hasSubstantialHan(input: string, minimum: number, ratio: number): boolean {
  let han = 0
  let countable = 0
  for (const character of input.replaceAll(/__DSH_PROTECTED_\d+__/g, '')) {
    if (COUNTABLE.test(character)) countable++
    if (HAN.test(character)) han++
  }
  return han >= minimum && countable > 0 && han / countable >= ratio
}
