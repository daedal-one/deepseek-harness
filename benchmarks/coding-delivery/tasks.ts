/** Fixed dependency-free coding tasks for coding-delivery trials. */

/** A value that survives JSON serialization without interpretation. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

/** One independently authored observable outcome for a coding task export. */
export interface EvaluationCase {
  readonly name: string
  readonly exportName: string
  readonly args: readonly JsonValue[]
  readonly expected: JsonValue
  /** Expected Error.name; exception messages are not acceptance requirements. */
  readonly expectError?: 'RangeError' | 'TypeError'
}

/** A fixed workspace, delivery contract, reference, and independent acceptance cases. */
export interface CodingTask {
  readonly id: string
  readonly category: string
  readonly prompt: string
  readonly files: Readonly<Record<string, string>>
  readonly solution: Readonly<Record<string, string>>
  readonly entrypoint: string
  readonly cases: readonly EvaluationCase[]
}

/** Fixed synthetic coding tasks used by both scripted and live delivery trials. */
export const CODING_TASKS: readonly CodingTask[] = [
  {
    id: 'bugfix-retry-delay',
    category: 'bugfix',
    prompt: `Fix the retry-delay.mjs implementation. Deliver only retry-delay.mjs; package.json and README.md are protected.

Export retryDelay(attempt, baseMs, maxMs). All three inputs are numbers: attempt is a non-negative safe integer, baseMs and maxMs are positive safe integers, and maxMs must be at least baseMs. Throw RangeError for invalid inputs. Return baseMs multiplied by 2 to the attempt power, capped at maxMs. Attempt zero must return baseMs. The return value must remain a safe integer.`,
    files: {
      'package.json': '{"name":"retry-delay-task","private":true,"type":"module"}\n',
      'README.md': '# Retry delay task\n\nProtected benchmark fixture.\n',
      'retry-delay.mjs': `export function retryDelay(attempt, baseMs, maxMs) {
  return Math.min(maxMs, baseMs * 2 ** (attempt + 1))
}
`,
    },
    solution: {
      'retry-delay.mjs': `function assertPositiveSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(name + ' must be a positive safe integer')
  }
}

export function retryDelay(attempt, baseMs, maxMs) {
  if (!Number.isSafeInteger(attempt) || attempt < 0) {
    throw new RangeError('attempt must be a non-negative safe integer')
  }
  assertPositiveSafeInteger(baseMs, 'baseMs')
  assertPositiveSafeInteger(maxMs, 'maxMs')
  if (maxMs < baseMs) {
    throw new RangeError('maxMs must be at least baseMs')
  }
  return Math.min(maxMs, baseMs * 2 ** attempt)
}
`,
    },
    entrypoint: 'retry-delay.mjs',
    cases: [
      { name: 'first attempt uses the base delay', exportName: 'retryDelay', args: [0, 125, 5_000], expected: 125 },
      { name: 'ordinary exponential growth', exportName: 'retryDelay', args: [3, 125, 5_000], expected: 1_000 },
      { name: 'large attempts cap without overflow escaping', exportName: 'retryDelay', args: [100, 125, 750], expected: 750 },
      { name: 'negative attempts reject', exportName: 'retryDelay', args: [-1, 125, 5_000], expected: null, expectError: 'RangeError' },
      { name: 'an inverted cap rejects', exportName: 'retryDelay', args: [0, 500, 125], expected: null, expectError: 'RangeError' },
      { name: 'fractional attempts reject', exportName: 'retryDelay', args: [0.5, 125, 5_000], expected: null, expectError: 'RangeError' },
      { name: 'numeric strings reject without coercion', exportName: 'retryDelay', args: [0, '125', 5_000], expected: null, expectError: 'RangeError' },
      { name: 'zero base delay rejects', exportName: 'retryDelay', args: [0, 0, 5_000], expected: null, expectError: 'RangeError' },
      { name: 'unsafe caps reject', exportName: 'retryDelay', args: [0, 1, 9_007_199_254_740_992], expected: null, expectError: 'RangeError' },
      { name: 'equal maximum-safe base and cap remain exact', exportName: 'retryDelay', args: [0, 9_007_199_254_740_991, 9_007_199_254_740_991], expected: 9_007_199_254_740_991 },
      { name: 'overflowing powers still cap', exportName: 'retryDelay', args: [9_007_199_254_740_991, 1, 750], expected: 750 },
    ],
  },
  {
    id: 'feature-tag-index',
    category: 'feature',
    prompt: `Implement the feature in tag-index.mjs. Deliver only tag-index.mjs; package.json and README.md are protected.

Export createTagIndex(posts). posts must be an array of records with a string id and an array of string tags; malformed posts, ids, or tags throw TypeError. Normalize each tag by trimming it, lowercasing ASCII letters, replacing each run of spaces, tabs, carriage returns, or newlines with one hyphen, removing every character except ASCII letters, digits, and hyphens, collapsing repeated hyphens, and removing leading or trailing hyphens. Ignore tags that become empty. Return a JSON object mapping every normalized tag to post ids in post input order. A post id appears at most once per normalized tag even when its raw tags normalize to the same value. The result must handle tags such as "constructor" as ordinary own keys.`,
    files: {
      'package.json': '{"name":"tag-index-task","private":true,"type":"module"}\n',
      'README.md': '# Tag index task\n\nProtected benchmark fixture.\n',
      'tag-index.mjs': `export function createTagIndex(posts) {
  return {}
}
`,
    },
    solution: {
      'tag-index.mjs': `function normalizeTag(tag) {
  return tag
    .trim()
    .replace(/[A-Z]/g, character => character.toLowerCase())
    .replace(/[ \\t\\r\\n]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function createTagIndex(posts) {
  if (!Array.isArray(posts)) throw new TypeError('posts must be an array')
  const index = Object.create(null)
  for (const post of posts) {
    if (post === null || typeof post !== 'object' || Array.isArray(post)) {
      throw new TypeError('each post must be a record')
    }
    if (typeof post.id !== 'string') throw new TypeError('post id must be a string')
    if (!Array.isArray(post.tags)) throw new TypeError('post tags must be an array')
    for (const tag of post.tags) {
      if (typeof tag !== 'string') throw new TypeError('each tag must be a string')
      const normalized = normalizeTag(tag)
      if (normalized === '') continue
      const ids = index[normalized] ?? []
      if (!ids.includes(post.id)) ids.push(post.id)
      index[normalized] = ids
    }
  }
  return index
}
`,
    },
    entrypoint: 'tag-index.mjs',
    cases: [
      {
        name: 'normalizes, deduplicates, and preserves post order',
        exportName: 'createTagIndex',
        args: [[
          { id: 'a', tags: [' Launch ', 'launch', 'node.js', 'C++'] },
          { id: 'b', tags: ['NODE JS', 'release---notes', 'constructor'] },
          { id: 'c', tags: ['  ', 'C++', 'release notes'] },
        ]],
        expected: {
          launch: ['a'],
          nodejs: ['a'],
          c: ['a', 'c'],
          'node-js': ['b'],
          'release-notes': ['b', 'c'],
          constructor: ['b'],
        },
      },
      {
        name: 'normalizes ASCII whitespace runs',
        exportName: 'createTagIndex',
        args: [[{ id: 'quality', tags: ['\nQuality\t Gate\r'] }]],
        expected: { 'quality-gate': ['quality'] },
      },
      {
        name: 'rejects a non-array tags field',
        exportName: 'createTagIndex',
        args: [[{ id: 'bad', tags: 'not-an-array' }]],
        expected: null,
        expectError: 'TypeError',
      },
      {
        name: 'repeated records keep each id once per normalized tag',
        exportName: 'createTagIndex',
        args: [[
          { id: 'a', tags: ['Release notes', 'constructor'] },
          { id: 'b', tags: ['release---notes'] },
          { id: 'a', tags: [' RELEASE NOTES ', 'constructor', 'new'] },
          { id: 'b', tags: ['new'] },
        ]],
        expected: { 'release-notes': ['a', 'b'], constructor: ['a'], new: ['a', 'b'] },
      },
      { name: 'empty input creates an empty index', exportName: 'createTagIndex', args: [[]], expected: {} },
      { name: 'null posts reject', exportName: 'createTagIndex', args: [[null]], expected: null, expectError: 'TypeError' },
      { name: 'non-string ids reject', exportName: 'createTagIndex', args: [[{ id: 1, tags: [] }]], expected: null, expectError: 'TypeError' },
      { name: 'non-string tags reject', exportName: 'createTagIndex', args: [[{ id: 'bad', tags: ['valid', null] }]], expected: null, expectError: 'TypeError' },
    ],
  },
  {
    id: 'project-order-quote',
    category: 'project',
    prompt: `Complete the small ESM project by editing src/fees.mjs and src/quote.mjs only. package.json and README.md are protected. The entrypoint is src/quote.mjs and must export quoteOrder(lines, region, couponPercent) and re-export shippingCents(subtotalCents, region).

shippingCents accepts a non-negative safe-integer subtotal and exactly "domestic" or "international". It returns 0 when subtotalCents is at least 5000; otherwise it returns 695 for domestic or 1495 for international. quoteOrder accepts a non-empty array of line records with non-negative safe-integer unitCents and positive safe-integer quantity, one of those regions, and an integer couponPercent from 0 through 100. It returns { subtotalCents, discountCents, shippingCents, totalCents }. subtotalCents is the sum of unitCents times quantity. discountCents is floor(subtotalCents * couponPercent / 100). Shipping uses the discounted subtotal. totalCents is discounted subtotal plus shipping. Throw TypeError for malformed line records or an invalid region, and RangeError for invalid numeric inputs or any subtotal or total that would exceed Number.MAX_SAFE_INTEGER.`,
    files: {
      'package.json': '{"name":"order-quote-task","private":true,"type":"module"}\n',
      'README.md': '# Order quote task\n\nProtected benchmark fixture.\n',
      'src/fees.mjs': `export function shippingCents(subtotalCents, region) {
  return 0
}
`,
      'src/quote.mjs': `import { shippingCents } from './fees.mjs'

export { shippingCents } from './fees.mjs'

export function quoteOrder(lines, region, couponPercent) {
  return { subtotalCents: 0, discountCents: 0, shippingCents: shippingCents(0, region), totalCents: 0 }
}
`,
    },
    solution: {
      'src/fees.mjs': `function assertSubtotal(subtotalCents) {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) {
    throw new RangeError('subtotalCents must be a non-negative safe integer')
  }
}

function assertRegion(region) {
  if (region !== 'domestic' && region !== 'international') {
    throw new TypeError('region must be domestic or international')
  }
}

export function shippingCents(subtotalCents, region) {
  assertSubtotal(subtotalCents)
  assertRegion(region)
  if (subtotalCents >= 5_000) return 0
  return region === 'domestic' ? 695 : 1_495
}
`,
      'src/quote.mjs': `import { shippingCents } from './fees.mjs'

export { shippingCents } from './fees.mjs'

const MAX_SAFE = Number.MAX_SAFE_INTEGER

function assertSafeInteger(value, name, minimum) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(name + ' is out of range')
  }
}

function lineTotal(line) {
  if (line === null || typeof line !== 'object' || Array.isArray(line)) {
    throw new TypeError('each line must be a record')
  }
  const { unitCents, quantity } = line
  assertSafeInteger(unitCents, 'unitCents', 0)
  assertSafeInteger(quantity, 'quantity', 1)
  if (unitCents !== 0 && quantity > Math.floor(MAX_SAFE / unitCents)) {
    throw new RangeError('line total exceeds Number.MAX_SAFE_INTEGER')
  }
  return unitCents * quantity
}

export function quoteOrder(lines, region, couponPercent) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new TypeError('lines must be a non-empty array')
  }
  if (region !== 'domestic' && region !== 'international') {
    throw new TypeError('region must be domestic or international')
  }
  assertSafeInteger(couponPercent, 'couponPercent', 0)
  if (couponPercent > 100) throw new RangeError('couponPercent is out of range')
  let subtotalCents = 0
  for (const line of lines) {
    const cents = lineTotal(line)
    if (subtotalCents > MAX_SAFE - cents) {
      throw new RangeError('subtotal exceeds Number.MAX_SAFE_INTEGER')
    }
    subtotalCents += cents
  }
  const discountCents = Math.floor(subtotalCents / 100) * couponPercent
    + Math.floor((subtotalCents % 100) * couponPercent / 100)
  const discountedSubtotal = subtotalCents - discountCents
  const shipping = shippingCents(discountedSubtotal, region)
  if (discountedSubtotal > MAX_SAFE - shipping) {
    throw new RangeError('total exceeds Number.MAX_SAFE_INTEGER')
  }
  return {
    subtotalCents,
    discountCents,
    shippingCents: shipping,
    totalCents: discountedSubtotal + shipping,
  }
}
`,
    },
    entrypoint: 'src/quote.mjs',
    cases: [
      {
        name: 'small domestic order includes shipping',
        exportName: 'quoteOrder',
        args: [[{ unitCents: 1_999, quantity: 2 }], 'domestic', 0],
        expected: { subtotalCents: 3_998, discountCents: 0, shippingCents: 695, totalCents: 4_693 },
      },
      {
        name: 'coupon can move an order below free shipping',
        exportName: 'quoteOrder',
        args: [[{ unitCents: 2_500, quantity: 2 }], 'domestic', 1],
        expected: { subtotalCents: 5_000, discountCents: 50, shippingCents: 695, totalCents: 5_645 },
      },
      {
        name: 'international order keeps its regional fee',
        exportName: 'quoteOrder',
        args: [[{ unitCents: 1_000, quantity: 3 }], 'international', 10],
        expected: { subtotalCents: 3_000, discountCents: 300, shippingCents: 1_495, totalCents: 4_195 },
      },
      {
        name: 'discount rounds down across multiple lines',
        exportName: 'quoteOrder',
        args: [[{ unitCents: 333, quantity: 3 }, { unitCents: 99, quantity: 1 }], 'domestic', 15],
        expected: { subtotalCents: 1_098, discountCents: 164, shippingCents: 695, totalCents: 1_629 },
      },
      {
        name: 'shipping is free at the threshold',
        exportName: 'shippingCents',
        args: [5_000, 'international'],
        expected: 0,
      },
      {
        name: 'invalid numeric quantities reject',
        exportName: 'quoteOrder',
        args: [[{ unitCents: 1, quantity: 0 }], 'domestic', 0],
        expected: null,
        expectError: 'RangeError',
      },
      {
        name: 'shipping is charged immediately below the threshold',
        exportName: 'shippingCents',
        args: [4_999, 'domestic'],
        expected: 695,
      },
      {
        name: 'a full coupon leaves only shipping',
        exportName: 'quoteOrder',
        args: [[{ unitCents: 5_001, quantity: 1 }], 'international', 100],
        expected: { subtotalCents: 5_001, discountCents: 5_001, shippingCents: 1_495, totalCents: 1_495 },
      },
      {
        name: 'the maximum safe subtotal remains exact',
        exportName: 'quoteOrder',
        args: [[{ unitCents: 9_007_199_254_740_991, quantity: 1 }], 'domestic', 0],
        expected: { subtotalCents: 9_007_199_254_740_991, discountCents: 0, shippingCents: 0, totalCents: 9_007_199_254_740_991 },
      },
      {
        name: 'line multiplication overflow rejects',
        exportName: 'quoteOrder',
        args: [[{ unitCents: 9_007_199_254_740_991, quantity: 2 }], 'domestic', 100],
        expected: null,
        expectError: 'RangeError',
      },
      {
        name: 'subtotal addition overflow rejects',
        exportName: 'quoteOrder',
        args: [[{ unitCents: 9_007_199_254_740_991, quantity: 1 }, { unitCents: 1, quantity: 1 }], 'domestic', 0],
        expected: null,
        expectError: 'RangeError',
      },
      {
        name: 'numeric strings reject without coercion',
        exportName: 'quoteOrder',
        args: [[{ unitCents: '100', quantity: 1 }], 'domestic', 0],
        expected: null,
        expectError: 'RangeError',
      },
      {
        name: 'coupons above one hundred reject',
        exportName: 'quoteOrder',
        args: [[{ unitCents: 100, quantity: 1 }], 'domestic', 101],
        expected: null,
        expectError: 'RangeError',
      },
      {
        name: 'malformed line records reject',
        exportName: 'quoteOrder',
        args: [[null], 'domestic', 0],
        expected: null,
        expectError: 'TypeError',
      },
      { name: 'negative shipping subtotals reject', exportName: 'shippingCents', args: [-1, 'domestic'], expected: null, expectError: 'RangeError' },
      { name: 'invalid regions reject even at free shipping', exportName: 'shippingCents', args: [5_000, 'unknown'], expected: null, expectError: 'TypeError' },
    ],
  },
]

/**
 * Look up one fixed coding task by identifier.
 * @param id - fixed coding-task identifier.
 * @returns the matching task.
 * @throws {Error} when no task has the requested identifier.
 */
export function taskById(id: string): CodingTask {
  const task = CODING_TASKS.find(candidate => candidate.id === id)
  if (task === undefined) throw new Error(`unknown coding task: ${id}`)
  return task
}
