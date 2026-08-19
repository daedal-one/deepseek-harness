/** Conservative deterministic recognition of bounded read-only shell pipelines. @module @deepseek-ai/dsh-tool-policy-shell/safe-read */

import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, relative, resolve } from 'node:path'

type Pipeline = string[][]
type CommandList = Pipeline[]

interface ReadValidation {
  readonly cwd: string
}

function within(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

async function safePath(value: string, validation: ReadValidation): Promise<boolean> {
  if (value === '-') return true
  const absolute = resolve(validation.cwd, value)
  try {
    const [workspace, temporary, candidate] = await Promise.all([realpath(validation.cwd), realpath(tmpdir()), realpath(absolute)])
    return within(workspace, candidate) || within(temporary, candidate)
  } catch {
    return false
  }
}

function parseCommandList(command: string): CommandList | undefined {
  const commands: CommandList = []
  let stages: Pipeline = [[]]
  let token = ''
  let tokenStarted = false
  let requiresCommand = false
  let quote: "'" | '"' | undefined
  const pushToken = (): void => {
    if (!tokenStarted) return
    stages.at(-1)?.push(token)
    token = ''
    tokenStarted = false
  }
  const pushCommand = (): boolean => {
    pushToken()
    if (stages.at(-1)?.length === 0) return false
    commands.push(stages)
    stages = [[]]
    return true
  }
  for (let index = 0; index < command.length; index += 1) {
    const char = command.charAt(index)
    if (quote !== undefined) {
      if (char === quote) { quote = undefined; continue }
      if (quote === '"' && (char === '$' || char === '`' || char === '\\' || char === '\n' || char === '\r')) return undefined
      token += char
      tokenStarted = true
      continue
    }
    if (char === "'" || char === '"') { quote = char; tokenStarted = true; requiresCommand = false; continue }
    if (char === '\n' || char === '\r' || char === ';') {
      if (stages.at(-1)?.length === 0 && !tokenStarted) {
        if (stages.length > 1 || char === ';') return undefined
        continue
      }
      if (!pushCommand()) return undefined
      continue
    }
    if (/\s/u.test(char)) { pushToken(); continue }
    if (!tokenStarted && command.startsWith('2>/dev/null', index)) {
      const after = command.charAt(index + '2>/dev/null'.length)
      if (after.length > 0 && !/[\s|;&]/u.test(after)) return undefined
      index += '2>/dev/null'.length - 1
      continue
    }
    if (char === '&') {
      if (command[index + 1] !== '&' || !pushCommand()) return undefined
      requiresCommand = true
      index += 1
      continue
    }
    if (char === '|') {
      if (command[index + 1] === '|') return undefined
      pushToken()
      if (stages.at(-1)?.length === 0) return undefined
      stages.push([])
      continue
    }
    if (/[<>`$()*?\[\]{}\\!#]/u.test(char)) return undefined
    token += char
    tokenStarted = true
    requiresCommand = false
  }
  if (quote !== undefined) return undefined
  if (requiresCommand) return undefined
  if (stages.at(-1)?.length === 0 && !tokenStarted) return commands.length === 0 || stages.length > 1 ? undefined : commands
  return pushCommand() ? commands : undefined
}

const catFlags = new Set([
  '-A', '--show-all', '-b', '--number-nonblank', '-e', '-E', '--show-ends', '-n', '--number', '-s', '--squeeze-blank', '-t', '-T', '--show-tabs', '-u', '-v', '--show-nonprinting',
])
const grepBooleanFlags = new Set([
  '-a', '-b', '-c', '-E', '-F', '-h', '-H', '-i', '-I', '-l', '-L', '-n', '-o', '-P', '-q', '-r', '-s', '-v', '-w', '-x', '--binary-files=text', '--count', '--extended-regexp', '--files-with-matches', '--files-without-match', '--fixed-strings', '--ignore-case', '--line-number', '--no-filename', '--only-matching', '--perl-regexp', '--quiet', '--recursive', '--silent', '--text', '--word-regexp', '--invert-match', '--line-regexp',
])
const grepValueFlags = new Set(['-A', '-B', '-C', '-e', '--after-context', '--before-context', '--context', '--max-count', '-m'])
const grepFilterFlags = new Set(['--include', '--exclude', '--exclude-dir'])

async function validatePaths(values: readonly string[], validation: ReadValidation): Promise<boolean> {
  return (await Promise.all(values.map(value => safePath(value, validation)))).every(Boolean)
}

async function safeCat(args: readonly string[], validation: ReadValidation): Promise<boolean> {
  const paths = args.filter(arg => !catFlags.has(arg))
  if (paths.some(arg => arg.startsWith('-') && arg !== '-')) return false
  return validatePaths(paths, validation)
}

async function safeGrep(args: readonly string[], validation: ReadValidation): Promise<boolean> {
  let patternSeen = false
  const paths: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === undefined) return false
    if (grepBooleanFlags.has(arg) || /^-[abchHiIlLnoqsvwExFPr]+$/u.test(arg)) continue
    if (grepFilterFlags.has(arg)) { index += 1; if (args[index] === undefined) return false; continue }
    if (/^--(?:include|exclude|exclude-dir)=.+$/u.test(arg)) continue
    if (!patternSeen && grepValueFlags.has(arg)) {
      index += 1
      if (args[index] === undefined) return false
      if (arg === '-e') patternSeen = true
      continue
    }
    if (!patternSeen && /^-[ABCm]\d+$/u.test(arg)) continue
    if (!patternSeen && arg === '-f') {
      index += 1
      const path = args[index]
      if (path === undefined || !(await safePath(path, validation))) return false
      patternSeen = true
      continue
    }
    if (!patternSeen && arg.startsWith('-')) return false
    if (!patternSeen) { patternSeen = true; continue }
    if (arg.startsWith('-') && arg !== '-') return false
    paths.push(arg)
  }
  return patternSeen && validatePaths(paths, validation)
}

async function safeHeadOrTail(name: string, args: readonly string[], validation: ReadValidation): Promise<boolean> {
  const paths: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === undefined) return false
    if (name === 'tail' && ['-f', '-F', '--follow', '--retry', '--pid'].includes(arg)) return false
    if (['-n', '-c', '--lines', '--bytes'].includes(arg)) { index += 1; if (args[index] === undefined) return false; continue }
    if (/^-[nc]?\d+$/u.test(arg) || /^--(?:lines|bytes)=\d+$/u.test(arg) || arg === '-q' || arg === '-v' || arg === '--quiet' || arg === '--verbose') continue
    if (arg.startsWith('-') && arg !== '-') return false
    paths.push(arg)
  }
  return validatePaths(paths, validation)
}

async function safeSort(args: readonly string[], validation: ReadValidation): Promise<boolean> {
  const booleanFlags = new Set([
    '-b', '--ignore-leading-blanks', '-d', '--dictionary-order', '-f', '--ignore-case',
    '-g', '--general-numeric-sort', '-h', '--human-numeric-sort', '-i', '--ignore-nonprinting',
    '-M', '--month-sort', '-n', '--numeric-sort', '-R', '--random-sort', '-r', '--reverse',
    '-s', '--stable', '-u', '--unique', '-V', '--version-sort', '-z', '--zero-terminated', '--debug',
  ])
  const valueFlags = new Set(['-k', '--key', '-t', '--field-separator', '-S', '--buffer-size', '--batch-size', '--parallel'])
  const paths: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === undefined) return false
    if (booleanFlags.has(arg)) continue
    if (valueFlags.has(arg)) {
      index += 1
      if (args[index] === undefined) return false
      continue
    }
    if (/^-(?:k.+|t.|S.+)$/u.test(arg)
      || /^(?:--key|--field-separator|--buffer-size|--batch-size|--parallel)=.+$/u.test(arg)) continue
    if (arg.startsWith('-') && arg !== '-') return false
    paths.push(arg)
  }
  return validatePaths(paths, validation)
}

async function safeLs(args: readonly string[], validation: ReadValidation): Promise<boolean> {
  if (args.some(arg => ['--dereference', '--recursive'].includes(arg) || /^-[^-]*[LR]/u.test(arg))) return false
  return validatePaths(args.filter(arg => !arg.startsWith('-')), validation)
}

async function safeWc(args: readonly string[], validation: ReadValidation): Promise<boolean> {
  const flags = new Set([
    '-c', '--bytes', '-m', '--chars', '-l', '--lines', '-L', '--max-line-length', '-w', '--words',
  ])
  if (args.some(arg => arg.startsWith('-') && arg !== '-' && !flags.has(arg) && !/^-[cmlLw]+$/u.test(arg))) return false
  return validatePaths(args.filter(arg => !arg.startsWith('-')), validation)
}

async function safeSed(args: readonly string[], validation: ReadValidation): Promise<boolean> {
  let quiet = false
  let scriptSeen = false
  const paths: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === undefined) return false
    if (!scriptSeen && (arg === '-n' || arg === '--quiet' || arg === '--silent')) { quiet = true; continue }
    if (!scriptSeen && arg === '-e') {
      index += 1
      const script = args[index]
      if (script === undefined || !/^(?:\d+|\$)(?:,(?:\d+|\$))?p$/u.test(script)) return false
      scriptSeen = true
      continue
    }
    if (!scriptSeen && arg.startsWith('-')) return false
    if (!scriptSeen) {
      if (!/^(?:\d+|\$)(?:,(?:\d+|\$))?p$/u.test(arg)) return false
      scriptSeen = true
      continue
    }
    if (arg.startsWith('-') && arg !== '-') return false
    paths.push(arg)
  }
  return quiet && scriptSeen && validatePaths(paths, validation)
}

async function safeAwk(args: readonly string[], validation: ReadValidation): Promise<boolean> {
  const [program, ...paths] = args
  if (program === undefined || !/^NR\s*==\s*\d+\s*\{\s*print\s*\}$/u.test(program)) return false
  if (paths.some(path => path.startsWith('-'))) return false
  return validatePaths(paths, validation)
}

async function safeRgFiles(args: readonly string[], validation: ReadValidation): Promise<boolean> {
  if (args[0] !== '--files') return false
  const booleanFlags = new Set(['--hidden', '--no-hidden', '--no-ignore', '--no-ignore-dot', '--no-ignore-exclude', '--no-ignore-files', '--no-ignore-global', '--no-ignore-parent', '--one-file-system', '-0', '--null'])
  const valueFlags = new Set(['-g', '--glob', '--iglob', '-t', '--type', '-T', '--type-not'])
  const paths: string[] = []
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === undefined) return false
    if (booleanFlags.has(arg)) continue
    if (valueFlags.has(arg)) { index += 1; if (args[index] === undefined) return false; continue }
    if (arg.startsWith('--glob=') || arg.startsWith('--iglob=') || arg.startsWith('--type=') || arg.startsWith('--type-not=')) continue
    if (arg.startsWith('-') && arg !== '-') return false
    paths.push(arg)
  }
  return validatePaths(paths, validation)
}

async function safeStage(stage: readonly string[], validation: ReadValidation): Promise<boolean> {
  const [name, ...args] = stage
  switch (name) {
    case 'pwd': return args.length === 0
    case 'echo': return true
    case 'uname': return args.every(arg => /^-[asnrvmpio]+$/u.test(arg)
      || ['--all', '--kernel-name', '--nodename', '--kernel-release', '--kernel-version', '--machine', '--processor', '--hardware-platform', '--operating-system'].includes(arg))
    case 'awk': return safeAwk(args, validation)
    case 'cat': return safeCat(args, validation)
    case 'grep': return safeGrep(args, validation)
    case 'head':
    case 'tail': return safeHeadOrTail(name, args, validation)
    case 'sort': return safeSort(args, validation)
    case 'ls': return safeLs(args, validation)
    case 'sed': return safeSed(args, validation)
    case 'rg': return safeRgFiles(args, validation)
    case 'uniq': {
      const operands = args.filter(arg => !arg.startsWith('-'))
      return operands.length <= 1 && validatePaths(operands, validation)
    }
    case 'wc': return safeWc(args, validation)
    default: return false
  }
}

async function safeWorkingDirectory(stage: readonly string[], cwd: string): Promise<boolean> {
  if (stage.length !== 2 || stage[0] !== 'cd' || stage[1] === undefined) return false
  try {
    const [workspace, target] = await Promise.all([realpath(cwd), realpath(resolve(cwd, stage[1]))])
    return target === workspace
  } catch {
    return false
  }
}

async function classifyDeterministicRead(
  command: string,
  cwd: string,
): Promise<boolean> {
  const commands = parseCommandList(command.trim())
  if (commands === undefined) return false
  const validation: ReadValidation = { cwd }
  for (const pipeline of commands) {
    if (pipeline.length === 1 && pipeline[0]?.[0] === 'cd') {
      if (!(await safeWorkingDirectory(pipeline[0], cwd))) return false
      continue
    }
    if (!(await Promise.all(pipeline.map(stage => safeStage(stage, validation)))).every(Boolean)) return false
  }
  return true
}

/**
 * Recognize a bounded command whose stages only read resolved workspace or temporary paths and write to stdout.
 * @param command - exact shell command.
 * @param cwd - authoritative session workspace.
 * @returns whether every parsed stage stays in the baseline read scope.
 */
export async function isDeterministicRead(command: string, cwd: string): Promise<boolean> {
  return classifyDeterministicRead(command, cwd)
}
