import { SessionSeq } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {
  SubagentResultValidationRequest,
  SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import { validateStatusBlock } from '../src/index.ts'

const COMPLETE = `Status: DONE
Confidence: high
Spec issues: none
Deviations: none
Files: src/a.ts
Verification: tests passed
Commit: abcdef1
Warnings: none`

/** Build the trusted same-process validation input around authored child events. */
function request(
  text: string,
  role = 'coder',
  events: readonly SessionEvent[] = [],
): SubagentResultValidationRequest {
  const localAgent = {
    session: {
      header: { cwd: '/workspace' },
      snapshotEvents: () => events,
    },
  } as unknown as Agent
  const run = {
    id: 'child' as SessionId,
    localAgent,
    result: Promise.resolve({ output: [], stopReason: 'completed' }),
    dispose: () => Promise.resolve(),
  } satisfies SubagentRun
  return {
    role,
    label: 'test child',
    parent: {} as Agent,
    run,
    result: { output: [{ type: 'text', text }], stopReason: 'completed' },
  }
}

/** Authored successful tool-call pair for durable evidence checks. */
function successfulCall(name: string, args: Record<string, unknown>): SessionEvent[] {
  const callId = ToolCallId('call-1')
  return [
    {
      type: 'tool/call',
      seq: SessionSeq(0),
      time: 1,
      data: { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) },
    },
    {
      type: 'tool/result',
      surfaceOp: 'append',
      seq: SessionSeq(1),
      time: 2,
      data: {
        turn: 1,
        step: 1,
        message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'ok' }], isError: false }),
      },
    },
  ]
}

describe('status-block result validation', () => {
  it('accepts a complete implementer status block', () => {
    expect(validateStatusBlock('implementer-status', request(COMPLETE))).toEqual([])
  })

  it('reports missing fields without replacing the child output', () => {
    expect(validateStatusBlock('implementer-status', request('Status: DONE'))).toEqual([{
      code: 'missing-status-fields',
      message: 'The coder result is missing required status fields: Confidence:, Spec issues:, Deviations:, Files:, Verification:, Commit:, Warnings:',
      details: {
        missing: ['Confidence:', 'Spec issues:', 'Deviations:', 'Files:', 'Verification:', 'Commit:', 'Warnings:'],
      },
    }])
  })

  it('corroborates implementer file claims with successful mutation events', () => {
    const warnings = validateStatusBlock(
      'implementer-status',
      request(COMPLETE, 'coder', successfulCall('write', { file_path: 'src/b.ts', content: 'x' })),
    )
    expect(warnings).toEqual([{
      code: 'unreported-file-mutations',
      message: 'Durable child tool events show mutated paths absent from Files: src/b.ts',
      details: { paths: ['src/b.ts'] },
    }])
  })

  it('exempts guru planning and adversarial modes from implementer fields', () => {
    expect(validateStatusBlock('implementer-status', request(
      'Mode: ADVERSARIAL\nVerdict: REASONING SOUND',
      'guru',
    ))).toEqual([])
  })

  it('requires reviewer verdict fields and durable reads for defect paths', () => {
    const warnings = validateStatusBlock('review-verdict', request(
      'Verdict: DEFECTS\nDefects:\n- src/a.ts:12 blocker broken\nSummary: one defect',
      'reviewer',
    ))
    expect(warnings).toEqual([{
      code: 'unobserved-review-files',
      message: 'Reviewer defect paths lack matching durable read events: src/a.ts',
      details: { paths: ['src/a.ts'] },
    }])
  })

  it('accepts a reviewer defect backed by a successful read event', () => {
    expect(validateStatusBlock('review-verdict', request(
      'Verdict: DEFECTS\nDefects:\n- src/a.ts:12 blocker broken\nSummary: one defect',
      'reviewer',
      successfulCall('read', { file_path: 'src/a.ts' }),
    ))).toEqual([])
  })
})
