/** Deterministic read-only operation composition for the shipped SDK profile. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  equalJson,
  type OperationJudgmentProvider,
} from '@deepseek-ai/dsh-experimental-operation'

export const name = 'operation-sdk-fixture'
export const inject = ['tools', 'operations']

const records = [
  { id: 'alpha', region: 'west', title: 'First record' },
  { id: 'beta', region: 'east', title: 'Selected record' },
]
const selected = records[1]!
const identity = {
  provider: 'deterministic-fixture', model: 'closed-record-selector',
  encoder: 'fixture-utf8', tokenizer: 'fixture-byte-tokenizer',
  serialization: 'fixture-json-v1', deployment: 'fixture-only',
  deploymentManifest: { reference: 'authored-read-only-fixture', digest: 'fixture-manifest-v1' },
  calibrationId: 'fixture-not-model-calibration',
} as const

const provider: OperationJudgmentProvider = {
  identity,
  async prepare(draft) {
    const wire = {
      state: draft.state,
      question: draft.question,
      choices: draft.candidates.map(candidate => ({ id: candidate.id, text: candidate.description })),
    }
    return { draft, wire, inputTokens: Buffer.byteLength(JSON.stringify(wire), 'utf8'), identity }
  },
  async rank(prepared) {
    const winner = prepared.draft.candidates.find(candidate => candidate.kind === 'complete'
      || candidate.kind === 'continue' && equalJson(candidate.source?.value ?? null, selected))
    if (winner === undefined) throw new Error('fixture requires the complete beta record or completion')
    return {
      requestId: prepared.draft.id,
      identity,
      probabilities: Object.fromEntries(prepared.draft.candidates.map(candidate => [
        candidate.id, candidate === winner ? 1 : 0,
      ])),
      usage: { billingUnits: 0, inputTokens: prepared.inputTokens, outputTokens: 0 },
    }
  },
}

/**
 * Register two fixed in-memory readers and their exact-definition eligibility.
 * @param ctx SDK profile context with the opt-in operation service.
 */
export function apply(ctx: Context): void {
  const listRecords = defineTool({
    name: 'fixture_list_records',
    description: 'Read the complete fixed catalog of two fixture records without side effects.',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          records: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                region: { type: 'string', required: true },
                title: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: () => [{ type: 'text', text: 'Two records are available; canonical values carry their identities.' }],
    },
    async execute() { return { records } },
  })
  const readRecord = defineTool({
    name: 'fixture_read_record',
    description: 'Verify and return one complete fixed catalog record without side effects.',
    parameters: {
      id: { type: 'string', required: true },
      region: { type: 'string', required: true },
      title: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          region: { type: 'string', required: true },
          title: { type: 'string', required: true },
          verified: { type: 'boolean', required: true },
        },
      },
      render: () => [{ type: 'text', text: 'The complete canonical record was verified.' }],
    },
    async execute(args) {
      if (!records.some(record => equalJson(record, args))) throw new Error('fixture record does not exist')
      return { ...args, verified: true }
    },
  })
  ctx.effect(() => ctx.tools.register(listRecords), 'operation-fixture.listRecords')
  ctx.effect(() => ctx.tools.register(readRecord), 'operation-fixture.readRecord')
  ctx.effect(() => ctx.operations.toolPolicies.register(listRecords, {
    allowOutputReferences: true,
    validateArguments(args) {
      if (!equalJson(args, {})) throw new Error('fixture catalog accepts no arguments')
    },
    inspectResult(value) {
      if (!equalJson(value, { records })) throw new Error('fixture catalog result changed')
      return { kind: 'complete' }
    },
  }), 'operation-fixture.listPolicy')
  ctx.effect(() => ctx.operations.toolPolicies.register(readRecord, {
    allowOutputReferences: true,
    validateArguments(args) {
      if (!records.some(record => equalJson(record, args))) throw new Error('fixture record must match one complete source record')
    },
    inspectResult(value) {
      if (!records.some(record => equalJson(value, { ...record, verified: true }))) {
        throw new Error('fixture record result is not complete')
      }
      return { kind: 'complete' }
    },
  }), 'operation-fixture.readPolicy')
  ctx.effect(() => ctx.operations.registerJudgmentProvider(provider), 'operation-fixture.provider')
}
