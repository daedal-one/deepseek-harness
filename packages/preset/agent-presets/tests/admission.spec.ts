import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import {
  fingerprintSessionPrefix, resolveSessionAdmissions, validateSessionAdmission,
  type SessionAdmission, type SessionCompositionSource,
} from '../src/admission.ts'

function source(): SessionCompositionSource {
  return {
    header: { version: SESSION_FORMAT_VERSION, id: SessionId('legacy'), agentPreset: 'standard', createdAt: 1, cwd: resolve(tmpdir()), isSeeded: false },
    inheritedEventCount: SessionLogOffset(0),
    events: [{ type: 'session/end-seed', data: {}, seq: SessionSeq(0), time: 2 }],
  }
}

function admission(input = source()): SessionAdmission {
  return {
    sessionId: input.header.id,
    agentPreset: 'standard',
    createdAt: input.header.createdAt,
    cwd: input.header.cwd!,
    parentSession: null,
    origin: null,
    delegationDepth: null,
    isSeeded: false,
    inheritedEventCount: SessionLogOffset(0),
    prefix: fingerprintSessionPrefix(input, input.events.length),
    compositionPreset: 'host-wrapper',
  }
}

describe('operator admission configuration', () => {
  it('detaches and freezes every entry and prefix', () => {
    const input = structuredClone(admission())
    const entries = [input]
    const map = resolveSessionAdmissions(entries)
    Object.assign(input, { cwd: 'changed' })
    Object.assign(input.prefix, { eventCount: 9 })
    entries.length = 0
    const saved = map.get(SessionId('legacy'))!
    expect(saved).toEqual(admission())
    expect(Object.isFrozen(saved)).toBe(true)
    expect(Object.isFrozen(saved.prefix)).toBe(true)
  })

  it('rejects duplicate Session IDs even when both entries agree', () => {
    expect(() => resolveSessionAdmissions([admission(), admission()])).toThrow(/duplicate session admission/)
  })

  it.each(Object.keys(admission()))('requires the explicit %s identity field', (field) => {
    const entry = Object.fromEntries(Object.entries(admission()).filter(([key]) => key !== field))
    expect(() => resolveSessionAdmissions([entry])).toThrow()
  })

  it.each([
    { sessionId: '' }, { agentPreset: '' }, { cwd: '' }, { parentSession: '' }, { origin: 'fork' },
    { delegationDepth: -1 }, { delegationDepth: 0.5 }, { createdAt: Number.MAX_SAFE_INTEGER + 1 },
    { createdAt: -0 }, { inheritedEventCount: 1 }, { isSeeded: 'false' }, { compositionPreset: '../host' },
  ])('rejects malformed identity %j', (fields) => {
    expect(() => resolveSessionAdmissions([{ ...admission(), ...fields }])).toThrow()
  })

  it.each([
    { encoding: 'jsonl' }, { formatVersion: SESSION_FORMAT_VERSION + 1 }, { eventCount: 0 },
    { eventCount: 0.5 }, { eventCount: Number.MAX_SAFE_INTEGER + 1 }, { sha256: '0'.repeat(63) },
    { sha256: 'A'.repeat(64) }, { sha256: 'g'.repeat(64) },
  ])('rejects malformed prefix %j', (fields) => {
    const entry = admission()
    expect(() => resolveSessionAdmissions([{ ...entry, prefix: { ...entry.prefix, ...fields } }])).toThrow()
  })

  it('rejects non-list configuration and a fork cut beyond the admitted prefix', () => {
    expect(() => resolveSessionAdmissions(null)).toThrow()
    expect(() => resolveSessionAdmissions({})).toThrow()
    expect(() => resolveSessionAdmissions([{ ...admission(), isSeeded: true, inheritedEventCount: 2 }])).toThrow()
  })
})

describe('restored admission identity', () => {
  it.each([
    { id: SessionId('other') }, { agentPreset: 'minimal' }, { createdAt: 2 },
    { cwd: resolve(tmpdir()) + '/.' }, { parentSession: SessionId('parent') },
    { origin: 'subagent' as const }, { delegationDepth: 0 }, { isSeeded: true },
  ])('rejects a changed logical header %j', (fields) => {
    const input = source()
    expect(() => { validateSessionAdmission({ ...input, header: { ...input.header, ...fields } }, admission(input)) }).toThrow(/mismatches/)
  })

  it('compares the inherited cut separately from the header and rejects removed explicit depth', () => {
    const input = source()
    expect(() => {
      validateSessionAdmission({ ...input, inheritedEventCount: SessionLogOffset(1) }, admission(input))
    }).toThrow(/inheritedEventCount/)
    expect(() => { validateSessionAdmission(input, { ...admission(input), delegationDepth: 0 }) }).toThrow(/delegationDepth/)
  })

  it('requires both the header and full preset fold to retain the logical identity', () => {
    const input = source()
    const selected: SessionEvent = { type: 'agent-preset/selected', data: { agentPreset: 'minimal' }, seq: SessionSeq(1), time: 3 }
    expect(() => {
      validateSessionAdmission({ ...input, events: [...input.events, selected] }, admission(input))
    }).toThrow(/selected logical preset/)
    const switched = {
      ...input, header: { ...input.header, agentPreset: 'minimal' },
      events: [...input.events, { ...selected, data: { agentPreset: 'standard' } }],
    }
    expect(() => { validateSessionAdmission(switched, admission(input)) }).toThrow(/agentPreset/)
  })

  it('accepts later resume and permission suffixes without changing the original prefix length', () => {
    const input = source()
    const suffix = [
      { type: 'session/end-seed', data: {}, seq: SessionSeq(1), time: 3 },
      { type: 'permission/preset', data: { preset: 'read-only' }, seq: SessionSeq(2), time: 4 },
    ] as SessionEvent[]
    expect(() => { validateSessionAdmission({ ...input, events: [...input.events, ...suffix] }, admission(input)) }).not.toThrow()
  })

  it('rejects truncation and changes to event data, time, sequence, or envelope flags', () => {
    const input = source()
    const entry = admission(input)
    expect(() => { validateSessionAdmission({ ...input, events: [] }, entry) }).toThrow(/truncated/)
    for (const fields of [{ data: { inherited: true } }, { time: 3 }, { seq: SessionSeq(1) }, { ignorable: true as const }]) {
      expect(() => {
        validateSessionAdmission({ ...input, events: [{ ...input.events[0]!, ...fields } as SessionEvent] }, entry)
      }).toThrow(/digest mismatch/)
    }
  })
})

describe('logical-json-v1 fingerprint', () => {
  it('sorts keys by code units, emits __proto__ directly, and retains array order', () => {
    const data = JSON.parse('{"é":1,"a":[2,1],"__proto__":{"z":false,"a":null},"Z":"😀","10":10,"2":2}') as object
    const event = { type: 'session/end-seed', data, seq: SessionSeq(0), time: 2 } as SessionEvent
    const input = { ...source(), events: [event] }
    const canonical = `[${SESSION_FORMAT_VERSION},1,[{"data":{"10":10,"2":2,"Z":"😀","__proto__":{"a":null,"z":false},"a":[2,1],"é":1},"seq":0,"time":2,"type":"session/end-seed"}]]`
    const expected = createHash('sha256').update('dsh-agent-presets/logical-json-v1\0' + canonical, 'utf8').digest('hex')
    expect(fingerprintSessionPrefix(input, 1).sha256).toBe(expected)
    const reordered = JSON.parse('{"2":2,"10":10,"Z":"😀","__proto__":{"a":null,"z":false},"a":[2,1],"é":1}') as object
    expect(fingerprintSessionPrefix({ ...input, events: [{ ...event, data: reordered } as SessionEvent] }, 1).sha256).toBe(expected)
    const reversedArray = { ...event, data: { ...data, a: [1, 2] } } as unknown as SessionEvent
    expect(fingerprintSessionPrefix({ ...input, events: [reversedArray] }, 1).sha256).not.toBe(expected)
    const { __proto__: _removed, ...withoutProto } = data as Record<string, unknown>
    expect(fingerprintSessionPrefix({ ...input, events: [{ ...event, data: withoutProto } as SessionEvent] }, 1).sha256).not.toBe(expected)
  })

  it('rejects a noncurrent logical version, invalid count, and non-JSON prefix data', () => {
    const obsolete = { ...source(), header: { ...source().header, version: 0 } } as unknown as SessionCompositionSource
    expect(() => fingerprintSessionPrefix(obsolete, 1)).toThrow(/current logical/)
    for (const count of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, 2]) {
      expect(() => fingerprintSessionPrefix(source(), count)).toThrow(/eventCount/)
    }
    const input = source()
    const invalid = { ...input, events: [{ ...input.events[0], data: { invalid: undefined } }] } as unknown as SessionCompositionSource
    expect(() => fingerprintSessionPrefix(invalid, 1)).toThrow(/non-JSON/)
  })
})
