import { describe, expect, it } from 'vitest'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import type { SessionFormatEvent, SessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'

const header = { type: 'session', version: 0, id: 'fork-v0', createdAt: 1, delegationDepth: 0 }
const route = { provider: 'mock', model: 'mock' }
const user = { id: 'user-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Inspect this project.' }] }

function fixture(): SessionFormatEvent[] {
  const rows: SessionFormatEvent[] = []
  const append = (type: string, data: SessionFormatEvent['data'], fields = {}): number => {
    const seq = rows.length
    rows.push({ type, seq, time: seq + 1, data, ...fields })
    return seq
  }
  append('turn/start', { turn: 1 })
  append('subagent/descriptor', { version: 3, mode: 'one-shot', provider: 'in-process', principal: 'memory-reviewer' })
  append('step/start', { turn: 1, step: 1 })
  const userSeq = append('user/message', user, { surfaceOp: 'append' })
  const requestSeq = append('tool-policy/classifier-request', {
    turn: 1, providerId: 'shell', route, purpose: 'intent-context',
    input: { kind: 'intent-context', userMessageSeqs: [userSeq], maxUserMessageChars: 2048 },
    request: { system: 'Classify intent.', temperature: 0, maxTokens: 128, timeoutMs: 1000 },
  })
  const contextSeq = append('tool-policy/intent-context', {
    turn: 1, providerId: 'shell', requestSeq, userMessageSeq: userSeq,
    allowedEffects: ['read'], forbiddenEffects: ['write'], summary: 'Read the project.',
  })
  append('tool-policy/classifier-request', {
    turn: 1, callId: 'call-1', providerId: 'shell', route, purpose: 'effect-primary',
    input: { kind: 'effect', commandArgument: 'command', intentContextSeq: contextSeq, maxCommandChars: 2048, maxIntentChars: 2048 },
    request: { system: 'Classify effect.', temperature: 0, maxTokens: 128, timeoutMs: 1000 },
  })
  const textSeq = append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'Inspection complete.' } })
  const finishSeq = append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'finish', reason: { kind: 'stop' } } })
  append('assistant/message', {
    turn: 1, step: 1,
    message: { id: 'assistant-1', role: 'assistant', source: { kind: 'model', ...route }, content: [{ type: 'text', text: 'Inspection complete.' }] },
  }, { surfaceOp: 'append', sourceEventSeqs: [textSeq, finishSeq] })
  append('english-output/translation-request', {
    turn: 1, step: 1, target: route, translator: route, system: 'Translate prose.', messages: [user], maxTokens: 128,
    blocks: [{ index: 0, type: 'text', content: 'Untrusted original prose.' }],
  })
  append('english-output/translation-result', { turn: 1, step: 1, status: 'translated', blockIndexes: [0] })
  append('web/openrouter-search-llm-request', { endpoint: 'https://example.test/chat/completions', body: { model: 'mock', opaque: [3, 4] } })
  append('step/end', { turn: 1, step: 1 })
  append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  append('memory/extraction-request', {
    turn: 1, sourceEventSeqs: rows.map(row => row.seq), route,
    system: 'Extract durable facts.', messages: [user], maxTokens: 128,
  })
  append('memory/extraction-result', { turn: 1, blocks: [], finish: { kind: 'stop' }, proposedIds: [] })
  return rows
}

function migrate(rows: readonly SessionFormatEvent[]) {
  const reader = sessionFormatCatalog.createRestore(header, { recovery: 'strict', validation: 'current' })
  for (const row of rows) reader.decodeRow(row)
  return reader.finish()
}

describe('fork V0 history through the complete migration chain', () => {
  it('preserves principal and captured inputs while relocating policy references', () => {
    const source = fixture()
    const original = JSON.stringify(source)
    const target = migrate(source)
    const find = (type: string) => target.events.find(row => row.type === type)!
    const policy = find('tool-policy/intent-context').data as SessionFormatJsonObject
    expect(target.header.version).toBe(3)
    expect(target.events.some(row => row.type === 'system/message')).toBe(true)
    expect(target.events.some(row => row.type === 'assistant/chunk')).toBe(false)
    expect(source.some(row => row.type === 'assistant/chunk')).toBe(true)
    expect(policy['requestSeq']).toBe(find('tool-policy/classifier-request').seq)
    expect(policy['userMessageSeq']).toBe(find('user/message').seq)
    const effect = target.events.filter(row => row.type === 'tool-policy/classifier-request')[1]!.data as SessionFormatJsonObject
    expect((effect['input'] as SessionFormatJsonObject)['intentContextSeq']).toBe(find('tool-policy/intent-context').seq)
    expect(find('subagent/descriptor').data).toMatchObject({ principal: 'memory-reviewer' })
    expect(find('memory/extraction-request').data).toEqual({
      ...source.find(row => row.type === 'memory/extraction-request')!.data as SessionFormatJsonObject,
      sourceSessionFormatVersion: 0,
    })
    for (const type of ['english-output/translation-request', 'english-output/translation-result', 'web/openrouter-search-llm-request']) {
      expect(find(type).data).toEqual(source.find(row => row.type === type)!.data)
    }
    expect(JSON.stringify(source)).toBe(original)
  })

  it('refuses an unknown historical event even if its envelope is ignorable', () => {
    const rows = fixture()
    rows.push({ type: 'unknown-fork/authorization', seq: rows.length, time: 100, data: {}, ignorable: true })
    expect(() => migrate(rows)).toThrow(/unknown historical event type/)
  })

  it('rejects policy links that cannot name an earlier event', () => {
    const rows = fixture().map(row => row.type === 'tool-policy/intent-context'
      ? { ...row, data: { ...row.data as SessionFormatJsonObject, requestSeq: 999 } } : row)
    expect(() => migrate(rows)).toThrow()
  })
})
