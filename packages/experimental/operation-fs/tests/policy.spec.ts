import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { resolve, sep } from 'node:path'
import { resolveConfig } from '../src/config.ts'
import { createFsPolicies } from '../src/policy.ts'
import { configFor } from './config.ts'

const contexts: Context[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function fixture() {
  const root = resolve('fixture-repo')
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(LocalSubprocessRuntime)
  const config = resolveConfig(configFor(root))
  return { ctx, root, config, policies: createFsPolicies(ctx, config), caller: Object.freeze({ cwd: root }) }
}

function readResult(extra: Record<string, JsonValue> = {}): JsonValue {
  return {
    path: 'src/a.ts', offset: 1, lines: [{ number: 1, text: 'alpha' }], totalLines: 1,
    truncatedByBytes: false, truncatedLineNumbers: [], ...extra,
  }
}

describe('explicit filesystem operation admission', () => {
  it('resolves relative and absolute canonical sources without rewriting them and separates sessions', async () => {
    const { policies, root } = await fixture()
    const args = { file_path: 'src/a.ts', limit: 10 }
    const before = structuredClone(args)
    policies.read.validateArguments(args, { cwd: root })
    policies.read.validateArguments({ file_path: resolve(root, 'src/a.ts'), offset: 1, limit: 10 }, { cwd: resolve(root, 'other') })
    expect(args).toEqual(before)
    expect(() => { policies.read.validateArguments(args, { cwd: `${root}-else` }) }).toThrow('outside the approved roots')
    expect(() => { policies.read.validateArguments({ ...args, file_path: `${root}-else/a.ts` }, { cwd: root }) }).toThrow('outside the approved roots')
    expect(() => { policies.read.validateArguments(args, { cwd: undefined }) }).toThrow('actual caller session cwd')
  })

  it('allows a cwd above narrowly approved roots without granting access to that cwd', async () => {
    const { ctx, root, config } = await fixture()
    const policies = createFsPolicies(ctx, { ...config, approvedRoots: [resolve(root, 'src')] })
    policies.read.validateArguments({ file_path: 'src/a.ts', limit: 1 }, { cwd: root })
    policies.glob.validateArguments({ pattern: '*.ts', path: 'src' }, { cwd: root })
    expect(() => { policies.glob.validateArguments({ pattern: '*.ts' }, { cwd: root }) }).toThrow('outside the approved roots')
  })

  it.each(['cwd', 'root', 'sandbox_permissions', 'justification', 'run_in_background', 'command', 'timeoutMs'])('denies unknown %s in each family', async (field) => {
    const { policies, caller } = await fixture()
    for (const [tool, args] of [
      ['read', { file_path: 'a.ts', limit: 1 }], ['glob', { pattern: '*' }], ['grep', { pattern: 'alpha' }],
    ] as const) {
      expect(() => { policies[tool].validateArguments({ ...args, [field]: 'untrusted' }, caller) }).toThrow('unknown fields')
    }
  })

  it('requires bounded whole-read arguments and permits output references only for read', async () => {
    const { policies, caller } = await fixture()
    expect([
      policies.read.allowOutputReferences, policies.glob.allowOutputReferences, policies.grep.allowOutputReferences,
    ]).toEqual([true, false, false])
    for (const limit of [undefined, 0, -1, 1.5, 21, Number.MAX_SAFE_INTEGER]) {
      const args = { file_path: 'a.ts', ...(limit === undefined ? {} : { limit }) }
      expect(() => { policies.read.validateArguments(args, caller) }).toThrow('explicit positive limit')
    }
    expect(() => { policies.read.validateArguments({ file_path: 'a.ts', offset: 2, limit: 1 }, caller) }).toThrow('offset')
    expect(() => { policies.read.validateArguments([], caller) }).toThrow('JSON object')
    expect(() => { policies.read.validateArguments({ limit: 1 }, caller) }).toThrow('required field')
  })

  it('rejects NUL, unsupported source syntax, parent traversal and oversized text', async () => {
    const { policies, caller, config } = await fixture()
    for (const file_path of ['', ' ', '\0', '../a', 'src/../a', 'src\\..\\a', '~/a', 'file:///a', '//remote/a', 'a'.repeat(config.maxPathBytes + 1)]) {
      expect(() => { policies.read.validateArguments({ file_path, limit: 1 }, caller) }).toThrow()
    }
    for (const pattern of ['', '\0', 'a'.repeat(config.maxPatternBytes + 1)]) {
      expect(() => { policies.grep.validateArguments({ pattern }, caller) }).toThrow()
    }
    for (const pattern of ['!*.ts', '../*.ts']) expect(() => { policies.glob.validateArguments({ pattern }, caller) }).toThrow()
    expect(() => { policies.grep.validateArguments({ pattern: 'x', include: '../*.ts' }, caller) }).toThrow()
    policies.grep.validateArguments({ pattern: ' ', include: '*.{ts,tsx}' }, caller)
    expect(() => { policies.read.validateArguments({ file_path: 'C:/unapproved/a', limit: 1 }, caller) }).toThrow()
    const alternateStream = () => { policies.read.validateArguments({ file_path: 'src/a:stream', limit: 1 }, caller) }
    const nativeBackslash = () => { policies.read.validateArguments({ file_path: 'src\\a.ts', limit: 1 }, caller) }
    if (sep === '\\') {
      expect(alternateStream).toThrow('unsupported path syntax')
      expect(nativeBackslash).not.toThrow()
    } else {
      expect(alternateStream).not.toThrow()
      expect(nativeBackslash).toThrow('unsupported path syntax')
    }
  })

  it.each(['\ud800', '\udfff'])('rejects unpaired surrogate %j before UTF-8 conversion can substitute a different input', async (invalid) => {
    const { policies, caller, ctx, config, root } = await fixture()
    for (const [tool, args] of [
      ['read', { file_path: `bad${invalid}.ts`, limit: 1 }],
      ['glob', { pattern: `bad${invalid}.ts` }],
      ['glob', { pattern: '*', path: invalid }],
      ['grep', { pattern: invalid }],
      ['grep', { pattern: 'x', path: invalid }],
      ['grep', { pattern: 'x', include: invalid }],
    ] as const) {
      expect(() => { policies[tool].validateArguments(args, caller) }).toThrow('well-formed Unicode')
    }
    expect(() => createFsPolicies(ctx, { ...config, approvedRoots: [resolve(root, invalid)] })).toThrow('well-formed Unicode')
    expect(() => { policies.glob.validateArguments({ pattern: '*' }, { cwd: resolve(root, invalid) }) }).toThrow('well-formed Unicode')
    for (const valid of ['\ufffd', '\ufeff', '\ud83d\ude00']) {
      const args = { file_path: `${valid}.ts`, limit: 1 }
      policies.read.validateArguments(args, caller)
      policies.glob.validateArguments({ pattern: `*${valid}*` }, caller)
      policies.grep.validateArguments({ pattern: valid, include: `*${valid}*` }, caller)
      expect(args.file_path).toBe(`${valid}.ts`)
    }
  })

  it('fails mismatched, guest, and drifting provider worlds and cwd mappings', async () => {
    const { ctx, policies, caller, config } = await fixture()
    const world = Object.freeze({})
    const fsWorld = vi.spyOn(ctx.fs, 'executionWorld', 'get').mockReturnValue(world)
    expect(() => createFsPolicies(ctx, config)).toThrow('matching host')
    expect(() => { policies.read.validateArguments({ file_path: 'a.ts', limit: 1 }, caller) }).toThrow('matching host')
    const subprocessWorld = vi.spyOn(ctx.subprocess, 'executionWorld', 'get').mockReturnValue(world)
    expect(() => createFsPolicies(ctx, config)).toThrow('matching host')
    fsWorld.mockRestore()
    subprocessWorld.mockRestore()
    const cwdMapping = vi.spyOn(ctx.subprocess, 'resolveWorkingDirectory').mockReturnValue(resolve('elsewhere'))
    expect(() => { policies.glob.validateArguments({ pattern: '*' }, caller) }).toThrow('working-directory mapping')
    cwdMapping.mockRestore()
    const mapping = vi.spyOn(ctx.fs, 'processPathFromHostPath').mockReturnValue(undefined)
    expect(() => { policies.read.validateArguments({ file_path: 'a.ts', limit: 1 }, caller) }).toThrow('working-directory mapping')
    mapping.mockImplementation(path => path === caller.cwd ? path : undefined)
    expect(() => { policies.read.validateArguments({ file_path: 'a.ts', limit: 1 }, caller) }).toThrow('source path does not agree')
  })

  it('validates explicit deployment roots and rejects executable overrides', async () => {
    const { ctx, root, config } = await fixture()
    expect(() => resolveConfig({ ...config, ripgrepCommand: 'project-wrapper' } as typeof config)).toThrow('unsupported configuration field')
    expect(() => resolveConfig({ ...config, readMaxLines: Number.MAX_SAFE_INTEGER + 1 })).toThrow('safe integer')
    expect(() => resolveConfig({ ...config, readMaxLines: 0 })).toThrow()
    for (const approvedRoots of [[], ['relative'], [`${root}/../other`]]) {
      expect(() => createFsPolicies(ctx, resolveConfig({ ...config, approvedRoots }))).toThrow()
    }
    expect(Object.isFrozen(config)).toBe(true)
    expect(Object.isFrozen(config.approvedRoots)).toBe(true)
  })
})

describe('canonical filesystem evidence', () => {
  it('requires whole unclipped read evidence including complete empty files', async () => {
    const { policies } = await fixture()
    expect(policies.read.inspectResult(readResult())).toEqual({ kind: 'complete' })
    expect(policies.read.inspectResult(readResult({ lines: [], totalLines: 0 }))).toEqual({ kind: 'complete' })
    for (const extra of [
      { truncatedByBytes: true }, { truncatedLineNumbers: [1] }, { totalLines: 2 },
      { offset: 2, lines: [{ number: 2, text: 'beta' }], totalLines: 2 },
      { offset: 2, lines: [], totalLines: 0 },
    ]) expect(policies.read.inspectResult(readResult(extra)).kind).toBe('incomplete')
  })

  it('fails malformed read metadata and discontinuous or impossible line numbers', async () => {
    const { policies } = await fixture()
    for (const value of [null, {}, { lines: [] }, readResult({ totalLines: -1 }), readResult({ offset: 0 }),
      readResult({ lines: [{ number: 2, text: 'alpha' }] }), readResult({ lines: [{ number: 1, text: 1 }] }),
      readResult({ truncatedLineNumbers: [2] }), readResult({ truncatedLineNumbers: [1, 1] }),
      readResult({ truncatedByBytes: 'false' }), readResult({ extra: true }),
    ]) expect(policies.read.inspectResult(value).kind).toBe('failed')
  })

  it('accepts complete empty searches but never substitutes presentation facts for canonical results', async () => {
    const { policies } = await fixture()
    expect(policies.glob.inspectResult({ root: 'src', paths: [] })).toEqual({ kind: 'complete' })
    expect(policies.glob.inspectResult({ root: 'src', paths: ['src/a.ts', 'src/b.ts'] })).toEqual({ kind: 'complete' })
    expect(policies.grep.inspectResult({ matches: [] })).toEqual({ kind: 'complete' })
    expect(policies.grep.inspectResult({ matches: [{ path: 'a.ts', lineNumber: 1, line: '' }] })).toEqual({ kind: 'complete' })
    for (const value of [{ paths: [] }, { root: '.', paths: [null] }, { root: '.', paths: ['\0'] }, 'No files found']) {
      expect(policies.glob.inspectResult(value).kind).toBe('failed')
    }
    for (const value of [{ matches: [{ path: 'a', lineNumber: 0, line: 'x' }] }, { matches: [{ path: 'a', lineNumber: 1 }] }, { matches: 'No matches found' }]) {
      expect(policies.grep.inspectResult(value).kind).toBe('failed')
    }
  })
})
