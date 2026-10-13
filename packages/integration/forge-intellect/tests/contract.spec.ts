import { describe, expect, it } from 'vitest'
import { answerObject, reviewerContract, validateContract, type Packet } from '../src/contract.ts'
import { planDigest, readPlan, type Plan } from '../src/plan.ts'

const string = { type: 'string' }
const array = (items: object) => ({ type: 'array', items })
const object = (properties: object) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const schema = 'forge-intellect-verification-agent/v1' as const
function packet(): Packet {
  return {
    schema, role: 'assessor', stage: 'review',
    context: { obligations: [{ id: 'REQ:test/value' }, { id: 'REQ:test/value#c-value' }], sources: { 'value.mjs': { numbered_content: '1: export const value = 1;\n2: // evidence' } }, limitations: ['structural projection'] },
    results: [{ id: 'value-check' }],
    response_contract: object({ schema: { const: schema }, role: { const: 'assessor' }, reviews: array(object({ obligation: { enum: ['REQ:test/value', 'REQ:test/value#c-value'] }, assessment: { enum: ['supported', 'contradicted', 'inconclusive'] }, rationale: string, citations: array(object({ path: string, start: { type: 'integer', minimum: 1 }, end: { type: 'integer', minimum: 1 }, quote: string })), checks: array(string), limitations: array(string) })), blocking_findings: array(string) }),
  }
}
function response() {
  return { schema, role: 'assessor', reviews: ['REQ:test/value', 'REQ:test/value#c-value'].map(obligation => ({ obligation, assessment: 'supported', rationale: 'The actual assertion checks the returned value.', citations: [{ source: 'source-1', start: 1, end: 1 }], checks: ['value-check'], unresolved_gaps: [] })), blocking_findings: [] }
}

describe('native reviewer contract', () => {
  it('grounds selected ranges without changing substantive judgments or native input', () => {
    const native = packet()
    const original = structuredClone(native)
    const contract = reviewerContract(native)
    expect(contract.model.context.projection_notes).toEqual(['structural projection'])
    expect(contract.model.context.limitations).toBeUndefined()
    const result = contract.resolve(JSON.stringify(response()))
    expect(result.response.reviews).toMatchObject([{ assessment: 'supported', citations: [{ path: 'value.mjs', start: 1, end: 1, quote: 'export const value = 1;' }], limitations: [] }, {}])
    expect(result.citations).toHaveLength(2)
    expect(native).toEqual(original)
  })
  it.each([
    ['missing owner', (r: ReturnType<typeof response>) => { r.reviews.shift() }, /Missing obligations/],
    ['duplicate clause', (r: ReturnType<typeof response>) => { r.reviews.push(r.reviews[1]!) }, /duplicate/],
    ['owner without citation', (r: ReturnType<typeof response>) => { r.reviews[0]!.citations = [] }, /own citation/],
    ['unexecuted check', (r: ReturnType<typeof response>) => { r.reviews[0]!.checks = ['invented'] }, /Unexecuted/],
    ['unavailable source', (r: ReturnType<typeof response>) => { r.reviews[0]!.citations[0]!.source = 'source-99' }, /allowed list/],
    ['out of range', (r: ReturnType<typeof response>) => { r.reviews[0]!.citations[0]!.end = 50 }, /exceeds/],
    ['reversed range', (r: ReturnType<typeof response>) => { r.reviews[0]!.citations[0]!.start = 2 }, /exceeds/],
  ] as const)('rejects %s', (_label, mutate, expected) => {
    const answer = response()
    mutate(answer)
    expect(() => reviewerContract(packet()).resolve(JSON.stringify(answer))).toThrow(expected)
  })
  it('retains contradicted and inconclusive judgments without promoting them', () => {
    const r = response()
    r.reviews[0]!.assessment = 'inconclusive'
    r.reviews[0]!.citations = []
    r.reviews[0]!.checks = []
    r.reviews[1]!.assessment = 'contradicted'
    const resolved = reviewerContract(packet()).resolve(JSON.stringify(r))
    expect(resolved.response.reviews).toMatchObject([{ assessment: 'inconclusive' }, { assessment: 'contradicted' }])
  })
  it('rejects ambiguous answers and permits harmless framing', () => {
    const text = JSON.stringify(response())
    expect(() => answerObject(text + text)).toThrow(/exactly one/)
    expect(() => answerObject('no result')).toThrow(/exactly one/)
    expect(answerObject('```json\n' + text + '\n```')).toEqual(response())
  })
  it('rejects schema extensions instead of silently accepting unsupported rules', () => {
    expect(() =>{  validateContract('x', { type: 'string', pattern: '^a' }) }).toThrow(/Unsupported/)
    expect(() =>{  validateContract({ a: 1, b: 2 }, object({ a: { type: 'integer' } })) }).toThrow(/unexpected/)
    expect(() =>{  validateContract({}, object({ a: string })) }).toThrow(/missing/)
  })
})

describe('immutable plans', () => {
  const base: Omit<Plan, 'digest'> = {
    schema: 'deadal-intellect-plan/v1', id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', repository: '/repository', revision: 'a'.repeat(40),
    policy: { schema: 'forge-intellect-verification-policy/v1', id: 'fixture', subjects: ['REQ:test/value'], source_paths: ['value.mjs'], checks: [{ id: 'check', argv: ['node', 'verify.mjs'], obligations: ['REQ:test/value'], required: true, timeout_seconds: 10, success_markers: ['assertions passed'], failure_markers: ['AssertionError'] }], command_environment: {}, command_wrapper: [], generated_test_prefixes: [], max_probes: 0, max_context_bytes: 10000, agent_timeout_seconds: 60, run_timeout_seconds: 300 },
    reviewers: { assessor: { provider: 'fixture', model: 'reviewer' }, challenger: { provider: 'fixture', model: 'reviewer' } }, maxTokens: 1024,
  }
  it('binds commands, evidence markers, revision, scope and reviewer routes', () => {
    const plan = { ...structuredClone(base), digest: planDigest(base) }
    expect(readPlan(plan)).toEqual(plan)
    for (const mutate of [
      (p: Plan) => { p.policy.checks[0]!.argv = ['echo', 'forged'] },
      (p: Plan) => { p.policy.checks[0]!.success_markers = ['forged'] },
      (p: Plan) => { p.revision = 'b'.repeat(40) },
      (p: Plan) => { p.reviewers.challenger.model = 'other' },
      (p: Plan) => { p.policy.subjects.push('REQ:test/other') },
    ]) {
      const changed = structuredClone(plan)
      mutate(changed)
      expect(() => readPlan(changed)).toThrow(/changed/)
    }
  })
})

describe('native planning and schema boundaries', () => {
  function planning() {
    const input = packet()
    input.stage = 'plan'
    input.checks = [{ id: 'check' }]
    input.repository_files = ['value.mjs']
    input.response_contract = object({ schema: string, role: string, selected_checks: array(string), additional_reads: array(string), probes: array({ type: 'object', properties: {} }) })
    return input
  }
  const answer = { schema, role: 'assessor', selected_checks: ['check'], additional_reads: ['value.mjs'], probes: [] }
  it('accepts only approved checks and captured files and rejects generated probes', () => {
    const contract = reviewerContract(planning())
    expect(contract.resolve(JSON.stringify(answer)).response).toEqual(answer)
    expect(() => contract.resolve(JSON.stringify({ ...answer, role: 'challenger' }))).toThrow('role or schema mismatch')
    expect(() => contract.resolve(JSON.stringify({ ...answer, selected_checks: ['other'] }))).toThrow('Unknown check')
    expect(() => contract.resolve(JSON.stringify({ ...answer, additional_reads: ['foreign'] }))).toThrow('Unknown source')
    expect(() => contract.resolve(JSON.stringify({ ...answer, probes: [{}] }))).toThrow('probes are disabled')
  })
  it.each([
    [null, { type: 'null' }], ['text', { type: 'string' }], [2, { type: 'integer' }],
    [null, { anyOf: [{ type: 'string' }, { type: 'null' }] }],
    [{ optional: 'ok' }, { type: 'object', properties: { optional: string } }],
  ])('accepts supported native value %j', (input, rule) => { expect(() => { validateContract(input, rule) }).not.toThrow() })
  it.each([
    ['x', { type: 'boolean' }, 'Unsupported native response type'],
    ['x', { const: 'y' }, 'incorrect constant'],
    ['x', { type: 'null' }, 'expected null'],
    [2, { type: 'string' }, 'expected string'],
    [1.5, { type: 'integer' }, 'invalid integer'],
    [0, { type: 'integer', minimum: 1 }, 'invalid integer'],
    [4, { anyOf: [{ type: 'string' }, { type: 'null' }] }, 'incorrect alternative'],
  ])('rejects invalid native value %j', (input, rule, diagnostic) => { expect(() => { validateContract(input, rule) }).toThrow(diagnostic) })
  it('ignores malformed framing without accepting extra protocol objects', () => {
    const answer = { ...response(), note: 'quote " and slash \\ and braces {}' }
    expect(answerObject('{bad} {"other":true} ' + JSON.stringify(answer))).toEqual(answer)
  })
  it('requires substantive citation text and an executed check for supported claims', () => {
    const input = packet()
    input.context.sources['value.mjs']!.numbered_content = '1:   '
    expect(() => reviewerContract(input).resolve(JSON.stringify(response()))).toThrow('nonempty source evidence')
    const answer = response()
    answer.reviews[0]!.checks = []
    expect(() => reviewerContract(packet()).resolve(JSON.stringify(answer))).toThrow('executed check')
  })
})
