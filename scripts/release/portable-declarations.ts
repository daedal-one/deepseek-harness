/** Preserve the compiled declaration graph of an application without importing Host packages. */
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import ts from 'typescript'

/**
 * Copy one shared declaration graph, retaining imports and module augmentations.
 * The caller exclusively owns destination and removes it if this operation fails.
 * @param root - source checkout containing emitted package and vendor declarations.
 * @param destination - acquired output directory for the application distribution.
 * @param entries - repository-relative compiled declaration entrypoints.
 * @param externalPackages - declared dependencies whose identities remain external.
 * @returns relative declaration entrypoints usable from the distribution root.
 */
export function stageDeclarationGraph(
  root: string,
  destination: string,
  entries: readonly string[],
  externalPackages: readonly string[],
): readonly string[] {
  const sourceRoot = realpathSync(root)
  const copied = new Map<string, string>()
  const options: ts.CompilerOptions = {
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    module: ts.ModuleKind.NodeNext,
    target: ts.ScriptTarget.ES2024,
    types: [],
  }
  function outputReference(from: string, to: string): string {
    const path = relative(from, to).split(sep).join('/').replace(/\.d\.ts$/u, '.js')
    return path.startsWith('.') ? path : `./${path}`
  }
  function copy(file: string): string {
    const sourceFile = realpathSync(file)
    const path = relative(sourceRoot, sourceFile)
    if (isAbsolute(path) || !(path.startsWith(`packages${sep}`) || path.startsWith(`vendor${sep}`))
      || !path.endsWith('.d.ts')) {
      throw new Error(`portable declarations: expected an emitted package declaration: ${file}`)
    }
    const previous = copied.get(sourceFile)
    if (previous !== undefined) return previous
    const output = join(destination, 'types', path)
    copied.set(sourceFile, output)
    const source = readFileSync(sourceFile, 'utf8')
    const syntax = ts.createSourceFile(sourceFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    if (syntax.referencedFiles.length > 0 || syntax.typeReferenceDirectives.length > 0 || syntax.libReferenceDirectives.length > 0) {
      throw new Error(`portable declarations: unsupported reference directive: ${sourceFile}`)
    }
    const replacements: { start: number; end: number; text: string }[] = []
    function visit(node: ts.Node): void {
      const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
          ? node.argument.literal
          : ts.isModuleDeclaration(node) ? node.name : undefined
      if (specifier !== undefined && ts.isStringLiteral(specifier)) {
        const name = specifier.text
        if (!externalPackages.some(external => name === external || name.startsWith(`${external}/`))) {
          const resolved = ts.resolveModuleName(name, sourceFile, options, ts.sys).resolvedModule
          if (resolved === undefined) throw new Error(`portable declarations: unresolved module ${name} in ${sourceFile}`)
          const target = copy(resolved.resolvedFileName)
          replacements.push({
            start: specifier.getStart(syntax), end: specifier.end,
            text: JSON.stringify(outputReference(dirname(output), target)),
          })
        }
      }
      if (ts.isImportEqualsDeclaration(node)) throw new Error(`portable declarations: unsupported import assignment: ${sourceFile}`)
      ts.forEachChild(node, visit)
    }
    visit(syntax)
    let content = source
    for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
      content = content.slice(0, replacement.start) + replacement.text + content.slice(replacement.end)
    }
    mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output, content.replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu, ''))
    return output
  }
  return entries.map(entry => outputReference(destination, copy(join(sourceRoot, entry))))
}
