import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  FORGE_SESSION_PROTOCOL,
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

  it('binds the Spec render to exact bytes, revision, and Intellect evidence', () => {
    const parsed = parseCommandRequest(request())
    const rendered = '<spec-bundle />\n'
    parsed.payload.intent = {
      protocol: 'forge.spec.preflight/v1',
      baseline: 'forge-spec-v0.6.0',
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
    expect(parseStartPayload(parsed).intent.rendered).toBe(rendered)
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

  it('derives stable UUID identities for the action gateway', () => {
    expect(stableUuid('same')).toBe('aea2349f-e45c-58dc-878c-a0c479952c2d')
    expect(stableUuid('forge-session:session-1')).toBe('c74e9f79-d80c-50b8-a6b2-f6ad16eb84b7')
    expect(stableUuid('same')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
