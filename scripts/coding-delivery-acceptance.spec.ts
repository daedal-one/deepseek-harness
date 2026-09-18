import * as childProcess from 'node:child_process'
import * as fs from 'node:fs/promises'
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { evaluateTask } from '../benchmarks/coding-delivery/acceptance.ts'
import { CODING_TASKS, taskById, type CodingTask } from '../benchmarks/coding-delivery/tasks.ts'

vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>() }))
vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>() }))

const roots: string[] = []

async function createWorkspace(task: CodingTask): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-coding-delivery-test-'))
  roots.push(root)
  for (const [path, content] of Object.entries(task.files)) {
    const destination = join(root, path)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, content)
  }
  return root
}

async function applyReference(root: string, task: CodingTask): Promise<void> {
  for (const [path, content] of Object.entries(task.solution)) {
    await writeFile(join(root, path), content)
  }
}

async function evaluate(task: CodingTask, root: string, timeoutMs = 5_000) {
  const controller = new AbortController()
  return evaluateTask(task, root, { signal: controller.signal, timeoutMs })
}

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('coding-delivery acceptance', () => {
  it.each(CODING_TASKS)('rejects the unchanged $id baseline', async (task) => {
    const root = await createWorkspace(task)

    const result = await evaluate(task, root)

    expect(result).toMatchObject({ passed: false, failureKind: 'candidate', timedOut: false, exitCode: 0, signal: null, cleanupError: null, retainedVerifierRoot: null })
    expect(result.checks).toBeGreaterThan(0)
  })

  it.each(CODING_TASKS)('accepts the $id reference solution across all cases', async (task) => {
    const root = await createWorkspace(task)
    await applyReference(root, task)

    const result = await evaluate(task, root)

    expect(result).toMatchObject({
      passed: true,
      failureKind: null,
      checks: task.cases.length,
      timedOut: false,
      exitCode: 0,
      signal: null,
      cleanupError: null,
      retainedVerifierRoot: null,
    })
  })

  it.each([
    ['bugfix-retry-delay', 'RangeError'],
    ['feature-tag-index', 'TypeError'],
  ] as const)('accepts %s errors by name without message requirements', async (taskId, errorName) => {
    const task = taskById(taskId)
    const cases = task.cases.filter(evaluation => evaluation.expectError === errorName).slice(0, 1)
    expect(cases).toHaveLength(1)
    const root = await createWorkspace(task)
    await writeFile(join(root, task.entrypoint), `export function ${cases[0]!.exportName}() { throw new ${errorName}('unrelated wording') }\n`)

    const result = await evaluate({ ...task, cases }, root)

    expect(result).toMatchObject({ passed: true, failureKind: null, checks: 1, timedOut: false, exitCode: 0, signal: null })
  })

  it('rejects a different error name even when its message contains the expected name', async () => {
    const task = taskById('bugfix-retry-delay')
    const cases = task.cases.filter(evaluation => evaluation.expectError !== undefined).slice(0, 1)
    const root = await createWorkspace(task)
    await writeFile(join(root, task.entrypoint), "export function retryDelay() { throw new Error('RangeError') }\n")

    const result = await evaluate({ ...task, cases }, root)

    expect(result).toMatchObject({ passed: false, failureKind: 'candidate', checks: 1, timedOut: false, exitCode: 0, signal: null })
    expect(result.detail).toContain('rejected with Error instead of RangeError')
  })

  it.each([
    ['undefined', 'return undefined'],
    ['BigInt', 'return 1n'],
    ['circular values', 'const value = {}; value.self = value; return value'],
  ])('does not accept returning %s as an expected TypeError', async (_name, invalidReturn) => {
    const task = taskById('feature-tag-index')
    const root = await createWorkspace(task)
    const reference = task.solution[task.entrypoint]!.replace('export function createTagIndex', 'function referenceCreateTagIndex')
    await writeFile(join(root, task.entrypoint), `${reference}
export function createTagIndex(posts) {
  try { return referenceCreateTagIndex(posts) }
  catch { ${invalidReturn} }
}
`)

    const result = await evaluate(task, root)

    expect(result).toMatchObject({
      passed: false,
      failureKind: 'candidate',
      checks: task.cases.findIndex(evaluation => evaluation.expectError !== undefined) + 1,
      timedOut: false,
      exitCode: 0,
      signal: null,
      cleanupError: null,
      retainedVerifierRoot: null,
    })
    expect(result.detail).toContain('verifier failure:')
  })

  it.each([
    ['module initialization', "throw new TypeError('module failed')\nexport function createTagIndex() {}\n"],
    ['missing export', 'export {}\n'],
    ['non-function export', 'export const createTagIndex = undefined\n'],
  ])('does not accept %s failure as an expected TypeError', async (_name, source) => {
    const task = taskById('feature-tag-index')
    const cases = task.cases.filter(evaluation => evaluation.expectError === 'TypeError').slice(0, 1)
    expect(cases).toHaveLength(1)
    const root = await createWorkspace(task)
    await writeFile(join(root, task.entrypoint), source)

    const result = await evaluate({ ...task, cases }, root)

    expect(result).toMatchObject({ passed: false, failureKind: 'candidate', checks: 1, timedOut: false, exitCode: 0, signal: null })
    expect(result.detail).toContain('verifier failure:')
  })

  it('rejects duplicate ids across repeated post records independently of raw-tag duplicates', async () => {
    const task = taskById('feature-tag-index')
    const cases = task.cases.filter(evaluation => evaluation.name === 'repeated records keep each id once per normalized tag')
    expect(cases).toHaveLength(1)
    const root = await createWorkspace(task)
    await writeFile(join(root, task.entrypoint), task.solution[task.entrypoint]!.replace('if (!ids.includes(post.id)) ids.push(post.id)', 'ids.push(post.id)'))

    const result = await evaluate({ ...task, cases }, root)

    expect(result).toMatchObject({ passed: false, failureKind: 'candidate', checks: 1, timedOut: false, exitCode: 0, signal: null })
    expect(result.detail).toContain('instead of')
  })

  it('looks up known task ids and rejects unknown ids', () => {
    expect(taskById('feature-tag-index').category).toBe('feature')
    expect(() => taskById('missing-task')).toThrow('unknown coding task: missing-task')
  })

  it('rejects protected file changes before executing a case', async () => {
    const task = taskById('bugfix-retry-delay')
    const root = await createWorkspace(task)
    await applyReference(root, task)
    await writeFile(join(root, 'package.json'), '{"tampered":true}\n')

    const result = await evaluate(task, root)

    expect(result).toMatchObject({ passed: false, failureKind: 'candidate', checks: 0, timedOut: false })
    expect(result.detail).toContain('protected file package.json changed')
  })

  it.skipIf(process.platform === 'win32')('rejects a symbolic-link path ancestor', async () => {
    const task = taskById('project-order-quote')
    const root = await createWorkspace(task)
    await applyReference(root, task)
    await rename(join(root, 'src'), join(root, 'source'))
    await symlink(join(root, 'source'), join(root, 'src'), 'dir')

    const result = await evaluate(task, root)

    expect(result).toMatchObject({ passed: false, failureKind: 'candidate', checks: 0, timedOut: false })
    expect(result.detail).toContain('task path ancestor src is a symbolic link')
  })

  it('bounds the bytes returned by a read even when file stats remain within the limit', async () => {
    const task = taskById('bugfix-retry-delay')
    const root = await createWorkspace(task)
    vi.spyOn(fs, 'readFile').mockResolvedValueOnce(Buffer.alloc(1_048_577))

    const result = await evaluate(task, root)

    expect(result).toMatchObject({ passed: false, failureKind: 'candidate', checks: 0, timedOut: false, exitCode: null, signal: null })
    expect(result.detail).toBe('candidate rejection: task file package.json exceeds 1048576 bytes')
  })

  it('rejects a wrong editable implementation', async () => {
    const task = taskById('bugfix-retry-delay')
    const root = await createWorkspace(task)
    await writeFile(join(root, 'retry-delay.mjs'), 'export function retryDelay() { return 0 }\n')

    const result = await evaluate(task, root)

    expect(result).toMatchObject({ passed: false, failureKind: 'candidate', checks: 1, timedOut: false, exitCode: 0 })
  })

  it('aborts and reaps an evaluator case at its local deadline', async () => {
    const task = taskById('bugfix-retry-delay')
    const root = await createWorkspace(task)
    await writeFile(
      join(root, 'retry-delay.mjs'),
      'export function retryDelay() { return new Promise(() => { setInterval(() => {}, 1000) }) }\n',
    )

    const spawn = vi.spyOn(childProcess, 'spawn')
    const result = await evaluate(task, root, 500)

    expect(result).toMatchObject({ passed: false, failureKind: 'timeout', timedOut: true })
    expect(result.checks).toBe(1)
    const child = spawn.mock.results[0]?.value as childProcess.ChildProcess
    expect(child.pid).toBeDefined()
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
    expect(result).toMatchObject({ exitCode: child.exitCode, signal: child.signalCode })
  })

  it('rejects an already aborted evaluator signal', async () => {
    const task = taskById('bugfix-retry-delay')
    const root = await createWorkspace(task)
    const controller = new AbortController()
    controller.abort()

    const result = await evaluateTask(task, root, { signal: controller.signal, timeoutMs: 5_000 })

    expect(result).toEqual({
      passed: false,
      failureKind: 'aborted',
      detail: 'verification aborted',
      checks: 0,
      timedOut: false,
      exitCode: null,
      signal: null,
      cleanupError: null,
      retainedVerifierRoot: null,
    })
  })

  it('aborts a running case and preserves its reaped exit observations', async () => {
    const task = taskById('bugfix-retry-delay')
    const root = await createWorkspace(task)
    const controller = new AbortController()
    await writeFile(join(root, task.entrypoint), "export function retryDelay() { process.stdout.write('ready\\n'); return new Promise(() => { setInterval(() => {}, 1000) }) }\n")
    const spawn = childProcess.spawn
    let child: childProcess.ChildProcess | undefined
    vi.spyOn(childProcess, 'spawn').mockImplementation((command, args, options) => {
      child = spawn(command, args, options)
      child.stdout?.once('data', () => { controller.abort() })
      return child
    })

    const result = await evaluateTask(task, root, { signal: controller.signal, timeoutMs: 5_000 })

    expect(result).toMatchObject({ passed: false, failureKind: 'aborted', checks: 1, timedOut: false })
    expect(child?.pid).toBeDefined()
    expect(child!.exitCode !== null || child!.signalCode !== null).toBe(true)
    expect(result).toMatchObject({ exitCode: child!.exitCode, signal: child!.signalCode })
  })

  it('reports invalid evaluator options as infrastructure failure', async () => {
    const task = taskById('bugfix-retry-delay')
    const root = await createWorkspace(task)

    const result = await evaluate(task, root, 0)

    expect(result).toEqual({
      passed: false,
      failureKind: 'infrastructure',
      detail: 'infrastructure failure: timeoutMs must be a positive safe integer',
      checks: 0,
      timedOut: false,
      exitCode: null,
      signal: null,
      cleanupError: null,
      retainedVerifierRoot: null,
    })
  })

  it('keeps diagnostics intact for task validation failures before a verifier root exists', async () => {
    const task = taskById('bugfix-retry-delay')
    const root = await createWorkspace(task)

    const result = await evaluate({ ...task, files: {} }, root)

    expect(result).toEqual({
      passed: false,
      failureKind: 'infrastructure',
      detail: 'infrastructure failure: coding task has no initial files',
      checks: 0,
      timedOut: false,
      exitCode: null,
      signal: null,
      cleanupError: null,
      retainedVerifierRoot: null,
    })
  })

  it('reports verifier-root setup failures as infrastructure failure', async () => {
    const task = taskById('bugfix-retry-delay')
    const root = await createWorkspace(task)
    vi.spyOn(fs, 'mkdtemp').mockRejectedValueOnce(new Error('temporary directory unavailable'))

    const result = await evaluate(task, root)

    expect(result).toMatchObject({ passed: false, failureKind: 'infrastructure', checks: 0, timedOut: false, exitCode: null, signal: null })
    expect(result.detail).toBe('infrastructure failure: temporary directory unavailable')
  })

  it.each(['--permission', '--allow-fs-read'])('refuses to spawn when Node lacks %s', async (missingFlag) => {
    const task = taskById('bugfix-retry-delay')
    const root = await createWorkspace(task)
    const flags = process.allowedNodeEnvironmentFlags
    const spawn = vi.spyOn(childProcess, 'spawn')
    process.allowedNodeEnvironmentFlags = new Set([...flags].filter(flag => flag !== missingFlag))
    try {
      const result = await evaluate(task, root)

      expect(result).toMatchObject({ passed: false, failureKind: 'infrastructure', checks: 0, timedOut: false, exitCode: null, signal: null })
      expect(result.detail).toContain('requires Node.js with --permission and --allow-fs-read support')
      expect(spawn).not.toHaveBeenCalled()
    } finally {
      process.allowedNodeEnvironmentFlags = flags
    }
  })

  it('reports a synchronous spawn failure as infrastructure failure', async () => {
    const task = taskById('bugfix-retry-delay')
    const root = await createWorkspace(task)
    vi.spyOn(childProcess, 'spawn').mockImplementationOnce(() => { throw new Error('spawn unavailable') })

    const result = await evaluate(task, root)

    expect(result).toMatchObject({ passed: false, failureKind: 'infrastructure', checks: 0, timedOut: false, exitCode: null, signal: null })
    expect(result.detail).toBe('infrastructure failure: spawn unavailable')
  })

  it('retains the attempted check when the child reports a spawn error', async () => {
    const task = taskById('bugfix-retry-delay')
    const root = await createWorkspace(task)
    const spawn = childProcess.spawn
    vi.spyOn(childProcess, 'spawn').mockImplementationOnce((_command, args, options) => spawn(join(root, 'missing-node'), args, options))

    const result = await evaluate(task, root)

    expect(result).toMatchObject({ passed: false, failureKind: 'infrastructure', checks: 1, timedOut: false, exitCode: null, signal: null })
    expect(result.detail).toContain('unable to start verifier:')
  })

  it.each([
    { trigger: 'abort', killResult: 'false' },
    { trigger: 'abort', killResult: 'true' },
    { trigger: 'abort', killResult: 'throw' },
    { trigger: 'timeout', killResult: 'true' },
    { trigger: 'error', killResult: 'false' },
  ] as const)('bounds unconfirmed verifier closure after $trigger with kill $killResult', async ({ trigger, killResult }) => {
    const task = taskById('bugfix-retry-delay')
    const root = await createWorkspace(task)
    const controller = new AbortController()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const child = Object.assign(new childProcess.ChildProcess(), { pid: 42_424, stdout, stderr })
    const kill = vi.spyOn(child, 'kill').mockImplementation(() => {
      if (killResult === 'throw') throw new Error('termination unavailable')
      return killResult === 'true'
    })
    const unref = vi.spyOn(child, 'unref')
    const started = Promise.withResolvers<undefined>()
    let verifierRoot: string | undefined
    vi.spyOn(childProcess, 'spawn').mockImplementation((_command, _args, options) => {
      if (typeof options?.cwd !== 'string') throw new Error('missing verifier root')
      verifierRoot = options.cwd
      roots.push(verifierRoot)
      started.resolve(undefined)
      return child
    })
    const remove = vi.spyOn(fs, 'rm')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let settled = false
    const evaluation = evaluateTask(task, root, { signal: controller.signal, timeoutMs: 5_000 }).then((result) => {
      settled = true
      return result
    })
    try {
      await started.promise
      if (trigger === 'timeout') await vi.advanceTimersByTimeAsync(5_000)
      else if (trigger === 'error') child.emit('error', new Error('child process error'))
      else controller.abort()
      await vi.advanceTimersByTimeAsync(1_000)

      expect(settled).toBe(true)
      const result = await evaluation
      expect(result).toMatchObject({
        passed: false,
        failureKind: 'infrastructure',
        checks: 1,
        timedOut: trigger === 'timeout',
        exitCode: null,
        signal: null,
        retainedVerifierRoot: verifierRoot,
      })
      expect(result.cleanupError).toContain('exit/stdio closure was not confirmed within 1000 ms')
      if (killResult === 'false') expect(result.cleanupError).toContain('SIGKILL returned false')
      if (killResult === 'throw') expect(result.cleanupError).toContain('SIGKILL failed: termination unavailable')
      expect(result.detail).toBe(`infrastructure failure: ${result.cleanupError}`)
      expect((await fs.lstat(result.retainedVerifierRoot!)).isDirectory()).toBe(true)
      expect(remove).not.toHaveBeenCalled()
      expect(kill).toHaveBeenCalledExactlyOnceWith('SIGKILL')
      expect(unref).toHaveBeenCalledTimes(1)
      expect(child.listenerCount('error')).toBe(0)
      expect(child.listenerCount('close')).toBe(0)
      expect(stdout.listenerCount('data')).toBe(0)
      expect(stderr.listenerCount('data')).toBe(0)
      expect(stdout.destroyed).toBe(true)
      expect(stderr.destroyed).toBe(true)
    } finally {
      child.emit('close', null, null)
      await evaluation
      stdout.destroy()
      stderr.destroy()
      vi.useRealTimers()
    }
  })

  it.each(['exit', 'timeout'] as const)('retains %s observations when verifier cleanup fails', async (stop) => {
    const task = taskById('bugfix-retry-delay')
    const root = await createWorkspace(task)
    await writeFile(join(root, task.entrypoint), stop === 'exit'
      ? 'export function retryDelay() { process.exit(9) }\n'
      : 'export function retryDelay() { return new Promise(() => { setInterval(() => {}, 1000) }) }\n')
    const spawn = vi.spyOn(childProcess, 'spawn')
    vi.spyOn(fs, 'rm').mockImplementationOnce((path) => {
      roots.push(String(path))
      return Promise.reject(new Error(`cannot remove ${String(path)}`))
    })

    const result = await evaluate(task, root, stop === 'timeout' ? 500 : 5_000)

    expect(result).toMatchObject({ passed: false, failureKind: 'infrastructure', checks: 1, timedOut: stop === 'timeout' })
    const child = spawn.mock.results[0]?.value as childProcess.ChildProcess
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
    expect(result).toMatchObject({ exitCode: child.exitCode, signal: child.signalCode })
    expect(result.detail).toBe('infrastructure failure: verifier cleanup failed: cannot remove <verifier-root>')
    expect(result.cleanupError).toBe('verifier cleanup failed: cannot remove <verifier-root>')
    expect(result.retainedVerifierRoot).toBe(roots.at(-1))
    expect((await fs.lstat(result.retainedVerifierRoot!)).isDirectory()).toBe(true)
  })

  it('rejects an exit-zero candidate without verifier evidence', async () => {
    const task = taskById('bugfix-retry-delay')
    const root = await createWorkspace(task)
    await writeFile(join(root, 'retry-delay.mjs'), 'export function retryDelay() { process.exit(0) }\n')

    const result = await evaluate(task, root)

    expect(result).toMatchObject({ passed: false, failureKind: 'candidate', checks: 1, timedOut: false, exitCode: 0, signal: null })
    expect(result.detail).toContain('complete verifier result')
  })

  it('rejects a forged done marker without a complete verifier result', async () => {
    const task = taskById('bugfix-retry-delay')
    const root = await createWorkspace(task)
    await writeFile(
      join(root, 'retry-delay.mjs'),
      "export function retryDelay() { process.stdout.write('done\\n'); process.exit(0) }\n",
    )

    const result = await evaluate(task, root)

    expect(result).toMatchObject({ passed: false, failureKind: 'candidate', checks: 1, timedOut: false, exitCode: 0, signal: null })
    expect(result.detail).toContain('complete verifier result')
  })

  it('rejects a nonzero candidate exit even when the controller remains healthy', async () => {
    const task = taskById('bugfix-retry-delay')
    const root = await createWorkspace(task)
    await writeFile(join(root, 'retry-delay.mjs'), 'export function retryDelay() { process.exit(9) }\n')

    const result = await evaluate(task, root)

    expect(result).toMatchObject({ passed: false, failureKind: 'candidate', checks: 1, timedOut: false, exitCode: 9, signal: null })
    expect(result.detail).toContain('exited with code 9')
  })
})
