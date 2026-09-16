/** Build a portable application dependency set from one clean DSH source revision. */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import ts from 'typescript'
import { stageDeclarationGraph } from './portable-declarations.ts'
import { pnpmInvocation } from '../pnpm-invocation.ts'
import { capture, isEntry, runConcurrent } from './process.ts'

const supportDirectories = [
  'vendor/cordis',
  'vendor/cosmokit',
  'packages/util/brand',
  'packages/typert/protocol',
  'packages/util/values',
] as const

function packageManifest(
  root: string, directory: string,
): { name: string; version: string; license: string; zod?: string; standardSchema?: string } {
  const path = join(root, directory, 'package.json')
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`)
  const fields = value as Record<string, unknown>
  const { name, version, license, dependencies } = fields
  if (typeof name !== 'string' || typeof version !== 'string' || typeof license !== 'string'
    || name === '' || version === '' || license === '') throw new Error(`${path} requires name, version and license`)
  if (dependencies !== undefined && (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies))) {
    throw new Error(`${path} dependencies must be an object`)
  }
  const zod = (dependencies as Record<string, unknown> | undefined)?.zod
  if (zod !== undefined && (typeof zod !== 'string' || zod === '')) throw new Error(`${path} has an invalid Zod dependency`)
  const standardSchema = (dependencies as Record<string, unknown> | undefined)?.['@standard-schema/spec']
  if (standardSchema !== undefined && (typeof standardSchema !== 'string' || standardSchema === '')) {
    throw new Error(`${path} has an invalid Standard Schema dependency`)
  }
  return { name, version, license, ...(zod === undefined ? {} : { zod }), ...(standardSchema === undefined ? {} : { standardSchema }) }
}

function assertPortableImports(runtime: string): void {
  const source = ts.createSourceFile('portable.js', runtime, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const allowed = new Set(['@deepseek-ai/cordis', 'zod'])
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined)) {
      const target = node.moduleSpecifier
      if (target === undefined || !ts.isStringLiteral(target) || !allowed.has(target.text)) {
        throw new Error(`portable client: unsupported runtime import ${target?.getText(source) ?? '<absent>'}`)
      }
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      throw new Error('portable client: runtime imports must be static ESM dependencies')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

/**
 * Stage the existing portable runtime and declarations as a standalone Client package.
 * The caller owns build freshness and source provenance; this function performs no build.
 * @param root - Repository containing the compiled portable facade and shared manifests.
 * @param destination - New, exclusively acquired staging directory; never overwritten.
 * @param sourceCommit - Full revision recorded by the caller after checking source cleanliness.
 * @param application - include shared Conversation and Chat in one application declaration graph.
 * @returns Package identity used by the archive step.
 */
export function stagePortableClient(
  root: string, destination: string, sourceCommit: string, application = false,
): { name: string; version: string } {
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) throw new Error('portable client: expected a full source commit')
  const source = packageManifest(root, 'packages/api/remotes')
  const dependencies: Record<string, string> = {}
  for (const directory of supportDirectories.slice(2)) {
    const dependency = packageManifest(root, directory)
    dependencies[dependency.name] = dependency.version
  }
  const zod = source.zod
  if (zod === undefined) throw new Error('portable client: facade must declare its Zod runtime dependency')
  dependencies.zod = zod
  const cordis = packageManifest(root, supportDirectories[0])
  const identity = { name: application ? '@deepseek-ai/dsh-client' : '@deepseek-ai/dsh-api-remotes-client', version: source.version }
  const members = application
    ? [['api', 'packages/api/remotes'], ['conversation', 'packages/client/ui-conversation'], ['chat', 'packages/client/ui-chat']] as const
    : [['index', 'packages/api/remotes']] as const
  const runtimeFiles = members.map(([file, directory]) => {
    const runtime = readFileSync(join(root, directory, 'lib/portable.js'))
    assertPortableImports(runtime.toString('utf8'))
    return { file: `${file}.js`, runtime }
  })
  const declarations = application ? null : readFileSync(join(root, 'packages/api/remotes/lib/client/portable.d.ts'))
  const license = readFileSync(join(root, 'LICENSE'))
  const notices = application ? readFileSync(join(root, 'THIRD_PARTY_NOTICES.md')) : undefined
  if (application) {
    if (cordis.standardSchema === undefined) throw new Error('portable client: Cordis must declare its Standard Schema dependency')
    dependencies['@standard-schema/spec'] = cordis.standardSchema
  }
  mkdirSync(destination)
  try {
    for (const { file, runtime } of runtimeFiles) writeFileSync(join(destination, file), runtime)
    if (declarations === null) {
      const entries = stageDeclarationGraph(root, destination, members.map(([, directory]) => `${directory}/lib/types/client/portable.d.ts`), [cordis.name, ...Object.keys(dependencies)])
      writeFileSync(join(destination, 'index.d.ts'), `${entries.map(entry => `export * from ${JSON.stringify(entry)};`).join('\n')}\n`)
      writeFileSync(join(destination, 'index.js'), `${runtimeFiles.map(({ file }) => `export * from './${file}';`).join('\n')}\n`)
    } else {
      writeFileSync(join(destination, 'index.d.ts'), declarations)
    }
    writeFileSync(join(destination, 'LICENSE'), license)
    if (notices !== undefined) writeFileSync(join(destination, 'THIRD_PARTY_NOTICES.md'), notices)
    writeFileSync(join(destination, 'package.json'), `${JSON.stringify({
      ...identity,
      private: true,
      description: application ? 'Portable DSH APIs and shared Conversation and Chat assembly' : 'Portable generated DSH Client, Connection, Gateway, Workspace and Session APIs',
      type: 'module',
      license: source.license,
      main: './index.js',
      types: './index.d.ts',
      exports: { '.': { types: './index.d.ts', default: './index.js' }, './package.json': './package.json' },
      files: application ? ['*.js', 'index.d.ts', 'types/**/*.d.ts', 'LICENSE', 'THIRD_PARTY_NOTICES.md'] : ['index.js', 'index.d.ts', 'LICENSE'],
      dependencies,
      peerDependencies: { [cordis.name]: cordis.version },
      dshSource: application
        ? { commit: sourceCommit, packages: members.map(([, directory]) => packageManifest(root, directory).name), entry: './client/portable' }
        : { commit: sourceCommit, package: source.name, entry: './client/portable' },
    }, null, 2)}\n`)
    return identity
  } catch (error) {
    rmSync(destination, { recursive: true, force: true })
    throw error
  }
}

function cleanRevision(root: string): string {
  const status = capture('git', ['status', '--porcelain', '--untracked-files=all', '--', '.', ':(exclude).dev'], { cwd: root })
  if (status !== '') throw new Error(`portable client: commit source changes before packing:\n${status}`)
  return capture('git', ['rev-parse', 'HEAD'], { cwd: root })
}

async function pnpm(args: readonly string[], cwd: string): Promise<void> {
  const invocation = pnpmInvocation(args)
  await runConcurrent(invocation.command, invocation.args, { cwd, env: { ...process.env, NODE_ENV: 'production' } })
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: 'string' }, application: { type: 'boolean', default: false } }, allowPositionals: false })
  if (values.out === undefined) throw new Error('usage: pnpm run pack:portable-client [--application] --out <new directory outside this checkout>')
  const root = realpathSync(resolve(import.meta.dirname, '../..'))
  const output = join(realpathSync(dirname(resolve(values.out))), basename(resolve(values.out)))
  const within = relative(root, output)
  if (within === '' || (!within.startsWith(`..${sep}`) && within !== '..' && !isAbsolute(within))) {
    throw new Error('portable client: output must be outside the source checkout')
  }
  if (existsSync(output)) throw new Error('portable client: output already exists; select a new directory')
  const sourceCommit = cleanRevision(root)
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-portable-build-'))
  let acquired = false
  let complete = false
  try {
    mkdirSync(output)
    acquired = true
    await pnpm(['run', 'clean'], root)
    await pnpm(['run', 'build:lib'], root)
    const distribution = join(temporary, 'client')
    const client = stagePortableClient(root, distribution, sourceCommit, values.application)
    const members = [
      ...supportDirectories.map(directory => ({ ...packageManifest(root, directory), directory: join(root, directory) })),
      { ...client, directory: distribution },
    ]
    const archives = []
    for (const member of members) {
      await pnpm(['--dir', member.directory, 'pack', '--pack-destination', output], root)
      const filename = `${member.name.replace('@', '').replace('/', '-')}-${member.version}.tgz`
      const bytes = readFileSync(join(output, filename))
      archives.push({ name: member.name, version: member.version, file: filename, sha256: createHash('sha256').update(bytes).digest('hex') })
    }
    if (cleanRevision(root) !== sourceCommit) throw new Error('portable client: source revision changed during the build')
    writeFileSync(join(output, 'manifest.json'), `${JSON.stringify({
      version: 1,
      sourceCommit,
      entry: client.name,
      archives,
    }, null, 2)}\n`)
    complete = true
    console.log(`portable client: ${String(archives.length)} archives from ${sourceCommit} in ${output}`)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
    if (acquired && !complete) rmSync(output, { recursive: true, force: true })
  }
}

if (isEntry(import.meta.url)) await main()
