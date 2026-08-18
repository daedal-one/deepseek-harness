/** Conservative deterministic recognition of bounded read-only shell pipelines. @module @deepseek-ai/dsh-tool-policy-shell/safe-read */

import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, relative, resolve } from 'node:path'

type Pipeline = string[][]

function within(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

async function safePath(value: string, cwd: string): Promise<boolean> {
  if (value === '-') return true
  const absolute = resolve(cwd, value)
  try {
    const [workspace, temporary, candidate] = await Promise.all([realpath(cwd), realpath(tmpdir()), realpath(absolute)])
    return within(workspace, candidate) || within(temporary, candidate)
  } catch {
    return false
  }
}

function parsePipeline(command: string): Pipeline | undefined {
  const stages: Pipeline = [[]]
  let token = ''
  let tokenStarted = false
  let quote: "'" | '"' | undefined
  const pushToken = (): void => {
    if (!tokenStarted) return
    stages.at(-1)?.push(token)
    token = ''
    tokenStarted = false
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
    if (char === "'" || char === '"') { quote = char; tokenStarted = true; continue }
    if (/\s/u.test(char)) { pushToken(); continue }
    if (char === '|') {
      if (command[index + 1] === '|') return undefined
      pushToken()
      if (stages.at(-1)?.length === 0) return undefined
      stages.push([])
      continue
    }
    if (/[;&<>`$()*?\[\]{}\\!#\n\r]/u.test(char)) return undefined
    token += char
    tokenStarted = true
  }
  if (quote !== undefined) return undefined
  pushToken()
  return stages.at(-1)?.length === 0 ? undefined : stages
}

const catFlags = new Set([
  '-A', '--show-all', '-b', '--number-nonblank', '-e', '-E', '--show-ends', '-n', '--number', '-s', '--squeeze-blank', '-t', '-T', '--show-tabs', '-u', '-v', '--show-nonprinting',
])
const grepBooleanFlags = new Set([
  '-a', '-b', '-c', '-E', '-F', '-h', '-H', '-i', '-I', '-l', '-L', '-n', '-o', '-P', '-q', '-s', '-v', '-w', '-x', '--binary-files=text', '--count', '--extended-regexp', '--files-with-matches', '--files-without-match', '--fixed-strings', '--ignore-case', '--line-number', '--no-filename', '--only-matching', '--perl-regexp', '--quiet', '--silent', '--text', '--word-regexp', '--invert-match', '--line-regexp',
])
const grepValueFlags = new Set(['-A', '-B', '-C', '-e', '--after-context', '--before-context', '--context', '--max-count', '-m'])

async function validatePaths(values: readonly string[], cwd: string): Promise<boolean> {
  return (await Promise.all(values.map(value => safePath(value, cwd)))).every(Boolean)
}

async function safeCat(args: readonly string[], cwd: string): Promise<boolean> {
  const paths = args.filter(arg => !catFlags.has(arg))
  if (paths.some(arg => arg.startsWith('-') && arg !== '-')) return false
  return validatePaths(paths, cwd)
}

async function safeGrep(args: readonly string[], cwd: string): Promise<boolean> {
  let patternSeen = false
  const paths: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === undefined) return false
    if (!patternSeen && (grepBooleanFlags.has(arg) || /^-[abchHiIlLnoqsvwExF]+$/u.test(arg))) continue
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
      if (path === undefined || !(await safePath(path, cwd))) return false
      patternSeen = true
      continue
    }
    if (!patternSeen && arg.startsWith('-')) return false
    if (!patternSeen) { patternSeen = true; continue }
    if (arg.startsWith('-') && arg !== '-') return false
    paths.push(arg)
  }
  return patternSeen && validatePaths(paths, cwd)
}

async function safeHeadOrTail(name: string, args: readonly string[], cwd: string): Promise<boolean> {
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
  return validatePaths(paths, cwd)
}

async function safeSort(args: readonly string[], cwd: string): Promise<boolean> {
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
  return validatePaths(paths, cwd)
}

async function safeLs(args: readonly string[], cwd: string): Promise<boolean> {
  if (args.some(arg => ['--dereference', '--recursive'].includes(arg) || /^-[^-]*[LR]/u.test(arg))) return false
  return validatePaths(args.filter(arg => !arg.startsWith('-')), cwd)
}

async function safeWc(args: readonly string[], cwd: string): Promise<boolean> {
  const flags = new Set([
    '-c', '--bytes', '-m', '--chars', '-l', '--lines', '-L', '--max-line-length', '-w', '--words',
  ])
  if (args.some(arg => arg.startsWith('-') && arg !== '-' && !flags.has(arg) && !/^-[cmlLw]+$/u.test(arg))) return false
  return validatePaths(args.filter(arg => !arg.startsWith('-')), cwd)
}

async function safeSed(args: readonly string[], cwd: string): Promise<boolean> {
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
  return quiet && scriptSeen && validatePaths(paths, cwd)
}

async function safeRgFiles(args: readonly string[], cwd: string): Promise<boolean> {
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
  return validatePaths(paths, cwd)
}

async function safeStage(stage: readonly string[], cwd: string): Promise<boolean> {
  const [name, ...args] = stage
  switch (name) {
    case 'pwd': return args.length === 0
    case 'cat': return safeCat(args, cwd)
    case 'grep': return safeGrep(args, cwd)
    case 'head':
    case 'tail': return safeHeadOrTail(name, args, cwd)
    case 'sort': return safeSort(args, cwd)
    case 'ls': return safeLs(args, cwd)
    case 'sed': return safeSed(args, cwd)
    case 'rg': return safeRgFiles(args, cwd)
    case 'uniq': {
      const operands = args.filter(arg => !arg.startsWith('-'))
      return operands.length <= 1 && validatePaths(operands, cwd)
    }
    case 'wc': return safeWc(args, cwd)
    default: return false
  }
}

/**
 * Recognize a deliberately small pipeline grammar whose stages can only read
 * resolved workspace or platform-temporary paths and write to stdout.
 * @param command - exact shell command.
 * @param cwd - authoritative session workspace.
 * @returns whether every parsed stage is in the deterministic read-only set.
 */
export async function isDeterministicRead(command: string, cwd: string): Promise<boolean> {
  const pipeline = parsePipeline(command.trim())
  if (pipeline === undefined) return false
  return (await Promise.all(pipeline.map(stage => safeStage(stage, cwd)))).every(Boolean)
}
