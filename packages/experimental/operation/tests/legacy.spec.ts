import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { replayOperation } from '../src/replay.ts'

// Immutable operation/* rows from commit 139b3697d0b25b5bd447ad689ad29ec05bded7c6,
// snapshots/sdk/clm-operations/session.v3.jsonl, wrapped in an array without changing any row.
// This owner-local event projection has no Session header; never regenerate it from the current writer.
const fixture = new URL('./fixtures/legacy-v1-operation-records.json', import.meta.url)
const originalProjectionDigest = 'a9ac8f1967bfab75209208fde1041d650e4cef7ae3f0865e10be7e4f1010e06a'

function legacyRecords(): SessionEvent[] {
  return JSON.parse(readFileSync(fixture, 'utf8')) as SessionEvent[]
}

describe('original committed operation v1 records', () => {
  it('preserves the exact original projection rather than stripping current-writer metadata', () => {
    expect(createHash('sha256').update(readFileSync(fixture)).digest('hex')).toBe(originalProjectionDigest)
    const events = legacyRecords()
    expect(events).toHaveLength(12)
    expect(events.every(event => event.type.startsWith('operation/'))).toBe(true)
    expect(events.every(event => !Object.hasOwn(event, 'seq') && !Object.hasOwn(event, 'time'))).toBe(true)
  })

  it('replays completed beta selection without a context, registered tools, or a judgment provider', () => {
    const events = legacyRecords()
    const original = structuredClone(events)
    const replay = replayOperation(events)
    expect(replay).toMatchObject({
      runId: '{{operation:1}}',
      status: 'completed',
      reason: 'completion checkpoint accepted',
      steps: [
        { stepId: 'list', tool: 'fixture_list_records', arguments: {}, outcome: 'succeeded', dispatch: 'unknown' },
        {
          stepId: 'verify', tool: 'fixture_read_record',
          arguments: { id: 'beta', region: 'east', title: 'Selected record' },
          outcome: 'succeeded', dispatch: 'unknown',
          result: { value: { id: 'beta', region: 'east', title: 'Selected record', verified: true } },
        },
      ],
      transitions: [
        { requestId: '{{judgment:1}}', candidateId: 'continue-1', nextStep: 'verify', arguments: { id: 'beta', region: 'east', title: 'Selected record' } },
        { requestId: '{{judgment:2}}', candidateId: 'complete' },
      ],
      terminal: {
        attemptedSteps: ['list', 'verify'], completedSteps: ['list', 'verify'],
        verification: [{ index: 0, passed: true, reason: 'passed' }],
      },
    })
    expect(events).toEqual(original)
  })

  it('retains missing legacy evidence instead of inventing caller, digest, or dispatch facts', () => {
    const events = legacyRecords()
    const replay = replayOperation(events)
    expect(replay.admission).toEqual(events[0]?.data)
    for (const field of ['caller', 'configuration', 'configurationDigest']) {
      expect(replay.admission).not.toHaveProperty(field)
    }
    expect(replay.admission.judgmentIdentity).not.toHaveProperty('configurationDigest')
    for (const identity of replay.admission.toolIdentities) {
      expect(identity).not.toHaveProperty('schemas')
    }
    for (const intent of events.filter(event => event.type === 'operation/step-start')) {
      expect(intent.data).not.toHaveProperty('schemaDigest')
      expect(intent.data).not.toHaveProperty('argumentsDigest')
    }
    const results = events.filter(event => event.type === 'operation/step-result')
    for (const [index, step] of replay.steps.entries()) {
      expect(step.dispatch).toBe('unknown')
      expect(step.result).toEqual(results[index]?.data)
      for (const field of ['callId', 'schemaDigest', 'valueDigest', 'execution']) {
        expect(step.result).not.toHaveProperty(field)
      }
    }
    const requests = events.filter(event => event.type === 'operation/judgment-request')
    expect(replay.judgments).toHaveLength(2)
    for (const [index, judgment] of replay.judgments.entries()) {
      expect(judgment.request).toEqual(requests[index]?.data)
      expect(judgment.request).not.toHaveProperty('fingerprints')
      expect(judgment.request.request).not.toHaveProperty('encoding')
    }
  })
})
