import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  FORGE_SESSION_PROTOCOL,
  FORGE_SPEC_BASELINES,
  FORGE_RECOVERY_PROTOCOL,
  ProtocolError,
  parseCommandRequest,
  parseStartPayload,
  stableUuid,
} from '../src/protocol.ts'

function request(): Record<string, unknown> {
  return {
    protocol: FORGE_SESSION_PROTOCOL,
    session_id: 'session-1',
    project_id: 'PROJECT:forge',
    work_id: 'TASK:work',
    intent_revision: 'a'.repeat(40),
    causality_id: 'cause-1',
    command: 'start',
    idempotency_key: 'start-1',
    payload: {},
    executor_policy: {
      max_minutes: 60,
      network: 'restricted',
      tools: ['git', 'spec'],
      credential_scopes: ['forgejo:project:write'],
      workspace: '/workspaces/session-1',
      executor_lease_id: 'agent-0123456789abcdef01234567',
    },
  }
}

describe('Forge protocol validation', () => {
  it('accepts the harness-neutral command envelope', () => {
    expect(parseCommandRequest(request())).toMatchObject({
      protocol: FORGE_SESSION_PROTOCOL,
      command: 'start',
      session_id: 'session-1',
    })
  })

  it('rejects unbounded executor authority', () => {
    const input = request()
    input.executor_policy = { ...input.executor_policy as object, tools: ['docker.sock'] }
    expect(() => parseCommandRequest(input)).toThrow(ProtocolError)
  })

  it.each(FORGE_SPEC_BASELINES)('binds %s to exact bytes, revision, and Intellect evidence', (baseline) => {
    const parsed = parseCommandRequest(request())
    const rendered = '<spec-bundle />\n'
    parsed.payload.intent = {
      protocol: 'forge.spec.preflight/v1',
      baseline,
      workspace_revision: parsed.intent_revision,
      target: parsed.work_id,
      rendered,
      rendered_sha256: createHash('sha256').update(rendered).digest('hex'),
      lint_errors: 0,
      evidence: {
        protocol: 'forge.intellect.action/v2',
        action_id: 'action-1',
        digest: 'digest-1',
      },
    }
    expect(parseStartPayload(parsed).intent).toMatchObject({ baseline, rendered })
    ;(parsed.payload.intent as Record<string, unknown>).baseline = 'forge-spec-v0.8.0'
    expect(() => parseStartPayload(parsed)).toThrow(/baseline/)
    ;(parsed.payload.intent as Record<string, unknown>).baseline = baseline
    ;(parsed.payload.intent as Record<string, unknown>).workspace_revision = 'b'.repeat(40)
    expect(() => parseStartPayload(parsed)).toThrow(/revision/)
    ;(parsed.payload.intent as Record<string, unknown>).workspace_revision = parsed.intent_revision
    ;(parsed.payload.intent as Record<string, unknown>).rendered_sha256 = 'wrong'
    expect(() => parseStartPayload(parsed)).toThrow(/digest/)
  })

  it('rejects a valid render for a different durable work item', () => {
    const parsed = parseCommandRequest(request())
    const rendered = '<spec-bundle id="TASK:other" />\n'
    parsed.payload.intent = {
      protocol: 'forge.spec.preflight/v1',
      baseline: 'forge-spec-v0.6.0',
      workspace_revision: parsed.intent_revision,
      target: 'TASK:other',
      rendered,
      rendered_sha256: createHash('sha256').update(rendered).digest('hex'),
      lint_errors: 0,
      evidence: {
        protocol: 'forge.intellect.action/v2',
        action_id: 'action-1',
        digest: 'digest-1',
      },
    }

    expect(() => parseStartPayload(parsed)).toThrow(/target/)
  })

  it('keeps recovered execution distinct from immutable intent and rejects malformed receipts', () => {
    const parsed = parseCommandRequest(request())
    const rendered = '<spec-bundle />\n'
    parsed.payload.intent = {
      protocol: 'forge.spec.preflight/v1', baseline: 'forge-spec-v0.7.0',
      workspace_revision: parsed.intent_revision, target: parsed.work_id, rendered,
      rendered_sha256: createHash('sha256').update(rendered).digest('hex'), lint_errors: 0,
      evidence: { protocol: 'forge.intellect.action/v2', action_id: 'preflight-1', digest: 'preflight-digest' },
    }
    const execution = {
      protocol: FORGE_RECOVERY_PROTOCOL, lease_id: parsed.executor_policy.executor_lease_id,
      checkpoint_id: 'checkpoint-agent-aaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbb',
      checkpoint_digest: 'c'.repeat(64), source_revision: 'b'.repeat(40), tree_digest: 'd'.repeat(64),
      intent_revision: parsed.intent_revision,
      evidence: { protocol: 'forge.intellect.action/v2', action_id: 'recovery-action', digest: 'e'.repeat(64) },
    }
    parsed.payload.execution = execution
    expect(parseStartPayload(parsed)).toMatchObject({ execution, intent: { workspace_revision: 'a'.repeat(40) } })
    for (const invalid of [
      { protocol: 'forge.executor.recovery/v0' }, { lease_id: 'agent-bbbbbbbbbbbbbbbbbbbbbbbb' },
      { intent_revision: 'b'.repeat(40) }, { checkpoint_id: '../checkpoint' },
      { checkpoint_digest: 'ABC' }, { source_revision: 'main' }, { tree_digest: 'dirty' },
      { evidence: { ...execution.evidence, digest: 'invalid' } },
      { evidence: { ...execution.evidence, protocol: 'unattributed' } },
      { evidence: { ...execution.evidence, action_id: 'x'.repeat(257) } }, { arbitrary_authority: true },
    ]) {
      parsed.payload.execution = { ...execution, ...invalid }
      expect(() => parseStartPayload(parsed)).toThrow(ProtocolError)
    }
    parsed.payload.execution = execution
    ;(parsed.payload.intent as Record<string, unknown>).workspace_revision = execution.source_revision
    expect(() => parseStartPayload(parsed)).toThrow(/revision/)
  })

  it('derives stable UUID identities for the action gateway', () => {
    expect(stableUuid('same')).toBe('aea2349f-e45c-58dc-878c-a0c479952c2d')
    expect(stableUuid('forge-session:session-1')).toBe('c74e9f79-d80c-50b8-a6b2-f6ad16eb84b7')
    expect(stableUuid('same')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
