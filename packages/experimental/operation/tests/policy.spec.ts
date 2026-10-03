import { describe, expect, it, vi } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  createForegroundProcessOperationPolicy,
  inspectForegroundProcessResult,
  OperationToolPolicyRegistry,
} from '../src/policy.ts'

function definition(name = 'fixture'): ToolDefinition {
  return {
    name,
    description: 'fixture',
    parameters: {},
    output: { schema: {}, render: () => [] },
    async execute() { return null },
  }
}

function foreground(overrides: Record<string, JsonValue> = {}): JsonValue {
  return {
    kind: 'foreground',
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 1_000,
    stdout: { text: 'ok', truncated: false },
    stderr: { text: '', truncated: false },
    sandbox: { mode: 'read-only', denied: false, runnerFailed: false },
    ...overrides,
  }
}

describe('operation tool policy registry', () => {
  it('admits only the exact independently registered definition instance', () => {
    const registry = new OperationToolPolicyRegistry()
    const registered = definition('read_fixture')
    const replacement = definition('read_fixture')
    const policy = {
      allowOutputReferences: true,
      validateArguments: vi.fn(),
      inspectResult: vi.fn(() => ({ kind: 'complete' as const })),
    }
    const dispose = registry.register(registered, policy)

    expect(registry.require(registered).inspectResult(null)).toEqual({ kind: 'complete' })
    expect(() => registry.require(replacement)).toThrow('no trusted operation policy for this definition instance')
    expect(() => registry.register(registered, policy)).toThrow('already registered')

    dispose()
    dispose()
    expect(() => registry.require(registered)).toThrow('no trusted operation policy for this definition instance')
  })

  it('does not own dispatch or infer eligibility from a tool name', () => {
    const registry = new OperationToolPolicyRegistry()
    const tool = definition('read_fixture')
    const execute = vi.spyOn(tool, 'execute')
    expect(() => registry.require(tool)).toThrow()
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('foreground process operation policy', () => {
  it('rejects background arguments before dispatch and accepts foreground arguments', () => {
    const policy = createForegroundProcessOperationPolicy()
    expect(policy.allowOutputReferences).toBe(false)
    expect(() => { policy.validateArguments({ command: 'status', run_in_background: true }, { cwd: '/workspace' }) }).toThrow('cannot run in the background')
    expect(() => { policy.validateArguments({ command: 'status', run_in_background: false }, { cwd: '/workspace' }) }).not.toThrow()
    expect(() => { policy.validateArguments('status', { cwd: '/workspace' }) }).toThrow('process arguments must be a JSON object')
  })

  it('hard-stops background, timeout, abort, signal, sandbox, and missing exit outcomes', () => {
    const cases: Array<[JsonValue, string]> = [
      [{ kind: 'background', jobId: 'job-1' }, 'not completed work'],
      [foreground({ timedOut: true }), 'timed out'],
      [foreground({ aborted: true }), 'was aborted'],
      [foreground({ signal: 'SIGTERM' }), 'terminated by signal'],
      [foreground({ sandbox: { mode: 'read-only', denied: true, runnerFailed: false } }), 'sandbox denied'],
      [foreground({ sandbox: { mode: 'read-only', denied: false, runnerFailed: true } }), 'sandbox runner failed'],
      [foreground({ exitCode: null }), 'did not report an exit code'],
      [foreground({ exitCode: 2 }), 'unexpected code 2'],
    ]
    for (const [value, reason] of cases) {
      const inspection = inspectForegroundProcessResult(value)
      expect(inspection.kind).toBe('failed')
      if (inspection.kind !== 'failed') throw new Error('expected failed inspection')
      expect(inspection.reason).toContain(reason)
    }
  })

  it('accepts only configured nonzero codes and reports truncated streams as incomplete', () => {
    const policy = createForegroundProcessOperationPolicy({ expectedNonzeroExitCodes: [1] })
    expect(policy.inspectResult(foreground({ exitCode: 1 }))).toEqual({ kind: 'complete' })
    expect(policy.inspectResult(foreground({ exitCode: 2 }))).toEqual({ kind: 'failed', reason: 'process exited with unexpected code 2' })
    expect(policy.inspectResult(foreground({ stdout: { text: 'partial', truncated: true } }))).toEqual({
      kind: 'incomplete', reason: 'process output is truncated',
    })
    expect(policy.inspectResult(foreground({ stderr: { text: 'partial', truncated: true } }))).toEqual({
      kind: 'incomplete', reason: 'process output is truncated',
    })
  })

  it('validates trusted expected codes and structured canonical facts', () => {
    expect(() => createForegroundProcessOperationPolicy({ expectedNonzeroExitCodes: [0] })).toThrow('nonzero safe integers')
    expect(() => createForegroundProcessOperationPolicy({ expectedNonzeroExitCodes: [1.5] })).toThrow('nonzero safe integers')
    expect(() => inspectForegroundProcessResult({ kind: 'foreground' })).toThrow('timedOut must be boolean')
    expect(() => inspectForegroundProcessResult(foreground({ stdout: 'rendered output' }))).toThrow('stdout must be a JSON object')
  })
})
