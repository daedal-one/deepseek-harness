import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import ts from 'typescript'
import { afterEach, expect, it } from 'vitest'
import { stageDeclarationGraph } from './portable-declarations.ts'

const roots: string[] = []
function fixture(files: Record<string, string>) {
  const parent = mkdtempSync(join(tmpdir(), 'dsh-declaration-graph-'))
  roots.push(parent)
  const root = join(parent, 'source')
  const destination = join(parent, 'staged')
  mkdirSync(root)
  mkdirSync(destination)
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  return { root, destination, parent }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('retains declaration merging, nominal identity, side-effect imports and cycles', () => {
  const { root, destination, parent } = fixture({
    'packages/view/index.d.ts': "export * from './core.ts'; import './node.ts';",
    'packages/view/core.d.ts': 'export interface Views {}\nexport type Kind = keyof Views;\nexport declare class Handle { private identity; }',
    'packages/view/node.d.ts': "import type { Handle } from './core.ts'; import './index.ts';\ndeclare module './core.ts' { interface Views { chat: Handle } }\nexport type Read = import('./core.ts').Handle;\n//# sourceMappingURL=node.d.ts.map\n",
  })
  const entries = stageDeclarationGraph(root, destination, ['packages/view/index.d.ts', 'packages/view/core.d.ts'], [])
  expect(entries).toEqual(['./types/packages/view/index.js', './types/packages/view/core.js'])
  expect(readFileSync(join(destination, 'types/packages/view/node.d.ts'), 'utf8')).toContain('import("./core.js").Handle')
  expect(readFileSync(join(destination, 'types/packages/view/node.d.ts'), 'utf8')).not.toContain('sourceMappingURL')
  const consumer = join(parent, 'consumer.mts')
  writeFileSync(consumer, `import type { Kind, Views, Handle } from './staged/types/packages/view/index.js';
const kind: Kind = 'chat';
declare const value: Views['chat'];
const handle: Handle = value;
// @ts-expect-error The merged target remains a discriminated key.
const invalid: Kind = 'unknown';
void kind; void handle; void invalid;
`)
  const program = ts.createProgram([consumer], {
    strict: true, noEmit: true, types: [],
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  })
  expect(ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([])
})

it('rewrites resolved package imports and leaves declared external identities shared', () => {
  const { root, destination } = fixture({
    'packages/view/index.d.ts': "export type { Value } from '@deepseek-ai/example'; import type {} from 'external/subpath';",
    'packages/view/node_modules/@deepseek-ai/example/package.json': JSON.stringify({ name: '@deepseek-ai/example', type: 'module', exports: { '.': { types: './index.d.ts' } } }),
    'packages/view/node_modules/@deepseek-ai/example/index.d.ts': 'export interface Value { readonly value: string }',
  })
  stageDeclarationGraph(root, destination, ['packages/view/index.d.ts'], ['external'])
  const result = readFileSync(join(destination, 'types/packages/view/index.d.ts'), 'utf8')
  expect(result).toContain('"./node_modules/@deepseek-ai/example/index.js"')
  expect(result).toContain("from 'external/subpath'")
})

it.each([
  ["export * from 'not-installed';", /unresolved module/u],
  ["export * from './missing.ts';", /unresolved module/u],
  ['/// <reference types="node" />\nexport {};', /reference directive/u],
  ['import value = require("external"); export { value };', /import assignment/u],
])('rejects an incomplete or unsupported declaration graph: %s', (source, error) => {
  const { root, destination } = fixture({ 'packages/view/index.d.ts': source })
  expect(() => stageDeclarationGraph(root, destination, ['packages/view/index.d.ts'], ['external'])).toThrow(error)
})

it('refuses source implementations and declarations outside package ownership', () => {
  const { root, destination } = fixture({
    'packages/view/source.ts': 'export const value = 1;',
    '.dev/outside.d.ts': 'export {};',
    'packages/view/index.d.ts': "export * from '../../.dev/outside.js';",
  })
  expect(() => stageDeclarationGraph(root, destination, ['packages/view/source.ts'], [])).toThrow('emitted package declaration')
  expect(() => stageDeclarationGraph(root, destination, ['packages/view/index.d.ts'], [])).toThrow('emitted package declaration')
})
