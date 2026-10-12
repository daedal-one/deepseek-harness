import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  FORGE_SESSION_PROTOCOL,
  ProtocolError,
  parseCommandRequest,
  parseStartPayload,
  stableUuid,
  type ForgeCommandRequest,
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

function intent(
  parsed: ForgeCommandRequest,
  rendered: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    protocol: 'forge.spec.preflight/v1',
    baseline: 'forge-spec-v0.7.0',
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
    ...overrides,
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
    parsed.payload.intent = intent(parsed, rendered)
    expect(parseStartPayload(parsed).intent.rendered).toBe(rendered)
    ;(parsed.payload.intent as Record<string, unknown>).rendered_sha256 = 'wrong'
    expect(() => parseStartPayload(parsed)).toThrow(/digest/)
  })

  it('rejects a valid render for a different durable work item', () => {
    const parsed = parseCommandRequest(request())
    const rendered = '<spec-bundle id="TASK:other" />\n'
    parsed.payload.intent = intent(parsed, rendered, { target: 'TASK:other' })

    expect(() => parseStartPayload(parsed)).toThrow(/target/)
  })

  it('omits the optional extended preflight fields when Forge does not send them', () => {
    const parsed = parseCommandRequest(request())
    parsed.payload.intent = intent(parsed, '<spec-bundle />\n')
    const start = parseStartPayload(parsed).intent
    expect('specRefs' in start).toBe(false)
    expect('repoRevision' in start).toBe(false)
  })

  it('parses declared spec refs and the repo revision of an extended preflight', () => {
    const parsed = parseCommandRequest(request())
    const digest = createHash('sha256').update('<spec-bundle />\n').digest('hex')
    parsed.payload.intent = intent(parsed, '<spec-bundle />\n', {
      specRefs: [{ id: 'REQ:forge/one', digest }],
      repoRevision: 'b'.repeat(40),
    })
    const start = parseStartPayload(parsed).intent
    expect(start.specRefs).toEqual([{ id: 'REQ:forge/one', digest }])
    expect(start.repoRevision).toBe('b'.repeat(40))
  })

  it('rejects malformed extended preflight fields', () => {
    const parsed = parseCommandRequest(request())
    const rendered = '<spec-bundle />\n'

    parsed.payload.intent = intent(parsed, rendered, { specRefs: [] })
    expect(() => parseStartPayload(parsed)).toThrow(/payload.intent.specRefs must be a non-empty array/)

    parsed.payload.intent = intent(parsed, rendered, { specRefs: 'REQ:forge/one' })
    expect(() => parseStartPayload(parsed)).toThrow(/payload.intent.specRefs must be a non-empty array/)

    parsed.payload.intent = intent(parsed, rendered, {
      specRefs: [{ id: 'REQ:forge/one', digest: 'NOT-A-DIGEST' }],
    })
    expect(() => parseStartPayload(parsed)).toThrow(/payload.intent.specRefs\[0\].digest must be a lowercase hex SHA-256/)

    parsed.payload.intent = intent(parsed, rendered, {
      specRefs: [{ id: 'REQ:forge/one', digest: 'a'.repeat(64) }],
      repoRevision: 'main',
    })
    expect(() => parseStartPayload(parsed)).toThrow(/payload.intent.repoRevision must be a lowercase hex commit id/)
  })

  it('derives stable UUID identities for the action gateway', () => {
    expect(stableUuid('same')).toBe('aea2349f-e45c-58dc-878c-a0c479952c2d')
    expect(stableUuid('forge-session:session-1')).toBe('c74e9f79-d80c-50b8-a6b2-f6ad16eb84b7')
    expect(stableUuid('same')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
