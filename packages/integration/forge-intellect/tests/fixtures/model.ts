/** Scripted model only; the profile, tools, checks and native evidence gate remain real. */
import { z } from 'zod'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-user-approval'
export const name = 'intellect-fixture-model'
export const inject = ['llm', 'approval']
function text(text: string): StreamChunk[] {
  return [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text }, { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'finish', reason: { kind: 'stop' } }]
}
function tool(n: number, name: string, args: object): StreamChunk[] {
  const id = ToolCallId(`fixture-${n}`)
  return [{ type: 'block-start', index: 0, blockType: 'tool-call' }, { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: JSON.stringify(args) }, { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) } }, { type: 'finish', reason: { kind: 'tool-calls' } }]
}
class FixtureModel extends LlmAdapter {
  private planId = ''
  private runId = ''
  private jobId = ''
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.model === 'reviewer') {
      if (options.tools?.length) throw new Error('Reviewer inherited tools')
      const first = options.messages.find(m => m.role === 'user')
      const input = first?.content.filter(b => b.type === 'text').map(b => b.text).join('') ?? ''
      const packet = z.object({
        schema: z.string(), role: z.string(), stage: z.string(),
        checks: z.array(z.object({ id: z.string() })).default([]),
        results: z.array(z.object({ id: z.string() })).nullish(),
        context: z.object({
          obligations: z.array(z.object({ id: z.string() })),
          sources: z.record(z.string(), z.object({ path: z.string().optional() })),
        }),
      }).parse(JSON.parse(input.slice(input.indexOf('\n') + 1)))
      const response = packet.stage === 'plan'
        ? {
          schema: packet.schema, role: packet.role,
          selected_checks: packet.checks.map((c: { id: string }) => c.id), additional_reads: [], probes: [], concerns: [],
        }
        : { schema: packet.schema, role: packet.role, reviews: packet.context.obligations.map((o: { id: string }) => ({ obligation: o.id, assessment: 'supported', rationale: 'Fixture reviewer says supported; native evidence must independently constrain this claim.', citations: [{ source: Object.keys(packet.context.sources).find(id => packet.context.sources[id]?.path === 'value.mjs'), start: 1, end: 1 }], checks: (packet.results ?? []).map((c: { id: string }) => c.id), unresolved_gaps: [] })), blocking_findings: [] }
      const correction = options.messages.filter(m => m.role === 'user').at(-1)?.content
        .filter(b => b.type === 'text').map(b => b.text).join('') ?? ''
      const needsCorrection = process.env.INTELLECT_TEST_MODE === 'invalid-protocol'
        || (process.env.INTELLECT_TEST_MODE === 'corrected-protocol' && !correction.includes('Delete unexpected fields'))
      yield* text(JSON.stringify(needsCorrection ? { ...response, stage: packet.stage } : response)); return
    }
    if (!options.tools?.length) { yield* text('Fixture verification'); return }
    const results = options.messages.flatMap(m => m.content).filter(b => b.type === 'tool-result')
    const last = results.at(-1)
    const content = last?.content.filter(b => b.type === 'text').map(b => b.text).join('') ?? ''
    const step = last ? Number(String(last.toolCallId).replace('fixture-', '')) + 1 : 0
    if (step === 0) { yield* tool(step, 'intellect_overview', {}); return }
    if (step === 1 && process.env.INTELLECT_TEST_MODE === 'no-repository') { yield* text('Choose a Git repository workspace, then ask me to verify its specifications.'); return }
    if (step === 1) { yield* tool(step, 'intellect_prepare', { subjects: ['REQ:test/nonnegative'], source_paths: ['value.mjs', 'verify.mjs'], checks: [{ id: 'nonnegative', argv: [process.execPath, 'verify.mjs'], obligations: ['REQ:test/nonnegative'], timeout_seconds: 15, success_markers: ['NONNEGATIVE_ASSERTIONS_PASSED'], failure_markers: ['AssertionError'] }] }); return }
    if (step === 2) {
      if (last?.isError) { yield* text('INTELLECT_PREPARE_FAILED: ' + content); return }
      this.planId = z.object({ id: z.string() }).parse(JSON.parse(content)).id
      if (!this.planId) { yield* text('INTELLECT_PREPARE_FAILED: Missing plan id in ' + content); return }
      yield* tool(step, 'intellect_run', { planId: this.planId }); return
    }
    if (step === 3) {
      if (last?.isError) { yield* text('INTELLECT_RUN_REJECTED: ' + content); return }
      const run = z.object({ runId: z.string(), jobId: z.string() }).parse(JSON.parse(content))
      this.runId = run.runId
      this.jobId = run.jobId
      yield* tool(step, process.env.INTELLECT_TEST_MODE === 'cancel' ? 'job_kill' : 'job_output', { job_id: this.jobId, ...(process.env.INTELLECT_TEST_MODE === 'cancel' ? {} : { wait: true, timeout_ms: 60000 }) }); return
    }
    if (step === 4) { yield* tool(step, 'intellect_result', { runId: this.runId, evidence: true }); return }
    if (step === 5 && process.env.INTELLECT_TEST_MODE !== 'cancel') { yield* tool(step, 'intellect_attest', { runId: this.runId }); return }
    if (process.env.INTELLECT_TEST_MODE === 'reassess') {
      if (step === 6) { yield* tool(step, 'intellect_reassess', { runId: this.runId, planId: this.planId }); return }
      if (step === 7) {
        if (last?.isError) { yield* text('INTELLECT_REASSESS_FAILED: ' + content); return }
        const run = z.object({ runId: z.string(), jobId: z.string() }).parse(JSON.parse(content))
        this.runId = run.runId
        yield* tool(step, 'job_output', { job_id: run.jobId, wait: true, timeout_ms: 60000 }); return
      }
      if (step === 8) { yield* tool(step, 'intellect_result', { runId: this.runId, evidence: true }); return }
      if (step === 9) { yield* tool(step, 'intellect_attest', { runId: this.runId }); return }
    }
    yield* text(`INTELLECT_FIXTURE_FINISHED ${last?.isError ? 'native-refusal' : 'native-result'} ${content}`)
  }
}
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['intellect-fixture'], new FixtureModel())
  ctx.on('approval/request', async () => {
    if (process.env.INTELLECT_TEST_MODE === 'reject') return 'rejected'
    if (process.env.INTELLECT_TEST_MODE === 'tampered-plan') {
      const root = join(process.cwd(), '.git/verification-fixture')
      const area = join(root, (await readdir(root))[0]!, 'plans')
      const path = join(area, (await readdir(area))[0]!, 'policy.json')
      const policy = z.object({ checks: z.array(z.object({ argv: z.array(z.string()) }).loose()) }).loose().parse(
        JSON.parse(await readFile(path, 'utf8')),
      ); policy.checks[0]!.argv = ['echo', 'forged']
      await writeFile(path, JSON.stringify(policy))
    }
    if (process.env.INTELLECT_TEST_MODE === 'dirty-approval') await writeFile(join(process.cwd(), 'unapproved.mjs'), 'unapproved change')
    return 'allowed-once'
  })
}
