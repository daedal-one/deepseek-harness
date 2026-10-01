import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { replayOperation } from '../src/replay.ts'

function records(): SessionEvent[] {
  return readFileSync(new URL('../../../../snapshots/sdk/clm-operations/session.v3.jsonl', import.meta.url), 'utf8')
    .trim().split('\n').map(line => JSON.parse(line) as SessionEvent)
    .filter(event => event.type.startsWith('operation/'))
    .map((event): SessionEvent => {
      // Earlier committed v1 records have no optional fingerprint/dispatch metadata.
      switch (event.type) {
        case 'operation/run-start': {
          const { caller: _caller, configuration: _configuration, configurationDigest: _digest, ...data } = event.data
          return { ...event, data: { ...data, toolIdentities: data.toolIdentities.map(({ schemas: _schemas, ...identity }) => identity) } }
        }
        case 'operation/step-start': {
          const { schemaDigest: _schema, argumentsDigest: _args, ...data } = event.data
          return { ...event, data }
        }
        case 'operation/step-result': {
          const { callId: _call, schemaDigest: _schema, valueDigest: _value, execution: _execution, ...data } = event.data
          return { ...event, data }
        }
        case 'operation/judgment-request': {
          const { fingerprints: _fingerprints, ...data } = event.data
          return { ...event, data }
        }
        default:
          return event
      }
    })
}

function replaceData(events: SessionEvent[], index: number, changes: Record<string, unknown>): void {
  const prior = events[index]
  if (prior === undefined) throw new Error('fixture event is missing')
  events[index] = { ...prior, data: { ...prior.data, ...changes } } as SessionEvent
}

function firstIndex(events: SessionEvent[], type: string): number {
  const index = events.findIndex(event => event.type === type)
  if (index < 0) throw new Error(`fixture has no ${type}`)
  return index
}

function tailThrough(events: SessionEvent[], type: string): SessionEvent[] {
  return events.slice(0, firstIndex(events, type) + 1)
}

describe('operation replay integrity', () => {
  it('reconstructs earlier v1 records without fabricating newer identity or dispatch facts', () => {
    const replay = replayOperation(records())
    expect(replay.admission.caller).toBeUndefined()
    expect(replay.admission.configurationDigest).toBeUndefined()
    expect(replay.steps.every(step => step.dispatch === 'unknown' && step.result?.execution === undefined)).toBe(true)
    expect(replay.judgments.every(judgment => judgment.request.fingerprints === undefined)).toBe(true)
  })

  it('reconstructs the complete supported-profile record selection from recorded facts', () => {
    expect(replayOperation(records())).toMatchObject({
      status: 'completed',
      transitions: [{ candidateId: 'continue-1', arguments: { id: 'beta', region: 'east' } }, { candidateId: 'complete' }],
      steps: [{ stepId: 'list', outcome: 'succeeded' }, { stepId: 'verify', outcome: 'succeeded' }],
      terminal: { verification: [{ passed: true }] },
      admission: { plan: { name: 'read-only-record-selection' } },
    })
  })

  it('rejects transition arguments that differ from the recorded candidate', () => {
    const events = records()
    replaceData(events, firstIndex(events, 'operation/transition'), { arguments: { id: 'alpha' } })
    expect(() => replayOperation(events)).toThrow('arguments that do not match its recorded candidate')
  })

  it('rejects a next-step intent that differs from its accepted continuation', () => {
    const events = records()
    const index = events.findIndex(event => event.type === 'operation/step-start' && event.data.stepId === 'verify')
    replaceData(events, index, { arguments: { id: 'alpha', region: 'west', title: 'First record' } })
    expect(() => replayOperation(events)).toThrow('preceding accepted continuation')
  })

  it('rejects a changed selected source even when transition and intent arguments still agree', () => {
    const events = records()
    const index = firstIndex(events, 'operation/judgment-request')
    const request = events[index]
    if (request?.type !== 'operation/judgment-request') throw new Error('fixture request is missing')
    replaceData(events, index, {
      request: {
        ...request.data.request,
        draft: {
          ...request.data.request.draft,
          candidates: request.data.request.draft.candidates.map(candidate => candidate.id === 'continue-1'
            ? { ...candidate, source: { ...candidate.source, pointer: '/records/0' } }
            : candidate),
        },
      },
    })
    expect(() => replayOperation(events)).toThrow('selected source does not match its canonical recorded result')
  })

  it('rejects a later step intent when its continuation transition is missing', () => {
    const events = records().filter(event => !(event.type === 'operation/transition' && event.data.candidateId === 'continue-1'))
    expect(() => replayOperation(events)).toThrow('preceding accepted continuation')
  })

  it('rejects a fixed tool change or out-of-order step intent', () => {
    for (const changes of [{ tool: 'unadmitted_tool' }, { stepId: 'verify' }]) {
      const events = records()
      replaceData(events, firstIndex(events, 'operation/step-start'), changes)
      expect(() => replayOperation(events)).toThrow('next fixed plan step and tool')
    }
  })

  it('rejects a transition without a candidate in its recorded response', () => {
    const events = records()
    const index = firstIndex(events, 'operation/judgment-result')
    const result = events[index]
    if (result?.type !== 'operation/judgment-result') throw new Error('fixture result is missing')
    replaceData(events, index, { response: { ...result.data.response, probabilities: { other: 1 } } })
    expect(() => replayOperation(events)).toThrow('without a recorded response/request candidate')
  })

  it('requires a final accepted completion transition before a completed terminal', () => {
    const events = records().filter(event => !(event.type === 'operation/transition' && event.data.candidateId === 'complete'))
    expect(() => replayOperation(events)).toThrow('final accepted completion checkpoint')
    const unaccepted = records()
    const index = unaccepted.findIndex(event => event.type === 'operation/transition' && event.data.candidateId === 'complete')
    replaceData(unaccepted, index, { accepted: false })
    expect(() => replayOperation(unaccepted)).toThrow('acceptance contradicts its candidate kind')
  })

  it('rejects terminal verification or completed step lists that contradict canonical facts', () => {
    for (const changes of [{ verification: [] }, { verification: [{ index: 0, passed: false, reason: 'failed' }] }]) {
      const events = records()
      replaceData(events, firstIndex(events, 'operation/run-end'), changes)
      expect(() => replayOperation(events)).toThrow('verification contradicts its canonical recorded results')
    }
    const missingStep = records()
    replaceData(missingStep, firstIndex(missingStep, 'operation/run-end'), { completedSteps: ['list'] })
    expect(() => replayOperation(missingStep)).toThrow('step lists contradict the admitted plan')
    const falseResult = records()
    const index = falseResult.findIndex(event => event.type === 'operation/step-result' && event.data.stepId === 'verify')
    replaceData(falseResult, index, { value: { id: 'beta', region: 'east', title: 'Selected record', verified: false } })
    expect(() => replayOperation(falseResult)).toThrow('step verification contradicts its canonical recorded results')
    const wrongCompletion = records()
    replaceData(wrongCompletion, index, { value: { id: 'alpha', region: 'east', title: 'Selected record', verified: true } })
    expect(() => replayOperation(wrongCompletion)).toThrow('completed operation verification contradicts its canonical recorded results')
  })

  it('rejects selected-run events after a terminal run-end', () => {
    const events = records()
    events.push(events[firstIndex(events, 'operation/step-start')]!)
    expect(() => replayOperation(events)).toThrow('event after operation/run-end')
  })

  it('retains a judgment failure without inventing a response or transition', () => {
    const events = tailThrough(records(), 'operation/judgment-result')
    replaceData(events, events.length - 1, { response: undefined, error: { code: 'JUDGMENT_TIMEOUT', message: 'provider timeout' } })
    expect(replayOperation(events)).toMatchObject({
      status: 'interrupted', transitions: [],
      judgments: [{ result: { error: { code: 'JUDGMENT_TIMEOUT' } } }],
    })
  })

  it('rejects duplicate transitions, overlapping checkpoints, and events preceding admission', () => {
    const events = records()
    const index = firstIndex(events, 'operation/transition')
    events.splice(index + 1, 0, events[index]!)
    expect(() => replayOperation(events)).toThrow('duplicate transitions')
    const overlapping = records()
    const requestIndex = firstIndex(overlapping, 'operation/judgment-request')
    const request = overlapping[requestIndex]
    if (request?.type !== 'operation/judgment-request') throw new Error('fixture request is missing')
    overlapping.splice(requestIndex + 1, 0, request)
    replaceData(overlapping, requestIndex + 1, {
      request: { ...request.data.request, draft: { ...request.data.request.draft, id: 'other-request' } },
    })
    expect(() => replayOperation(overlapping)).toThrow('multiple judgment checkpoints')
    const reordered = records()
    ;[reordered[0], reordered[1]] = [reordered[1]!, reordered[0]!]
    expect(() => replayOperation(reordered)).toThrow('precedes its run-start')
  })

  it('preserves every valid interrupted prefix including continuation intent without settlement', () => {
    const events = records()
    for (let length = 1; length < events.length; length += 1) {
      expect(replayOperation(events.slice(0, length)).status).toBe('interrupted')
    }
    const nextIntent = events.findIndex(event => event.type === 'operation/step-start' && event.data.stepId === 'verify')
    expect(replayOperation(events.slice(0, nextIntent + 1)).steps[1]).toMatchObject({ stepId: 'verify', outcome: 'unknown' })
  })

  it('retains unknown outcomes for aborted started steps and rejects duplicate settlement', () => {
    const events = tailThrough(records(), 'operation/step-result')
    replaceData(events, events.length - 1, {
      isError: true, value: undefined, error: { code: 'ABORTED', message: 'started body was aborted' }, assertions: [],
    })
    expect(replayOperation(events)).toMatchObject({ status: 'interrupted', steps: [{ outcome: 'unknown', result: { error: { code: 'ABORTED' } } }] })
    events.push(events.at(-1)!)
    expect(() => replayOperation(events)).toThrow('unpaired step result')
  })
})
