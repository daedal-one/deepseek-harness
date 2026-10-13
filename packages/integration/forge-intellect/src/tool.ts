/** Conversation tools for native verification; approval and attestation stay in the executor. */
import { z } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from './index.ts'

export const name = 'tool-forge-intellect'
export const inject = ['tools', 'forgeIntellect']

const output = {
  schema: { type: 'json' as const },
  render: (_args: unknown, result: unknown) => [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
}
const runParameter = { type: 'string' as const, required: true as const, description: 'Retained runId returned by intellect_run or listed by intellect_overview.' }

function owner(agent: Agent | undefined): Agent {
  if (!agent) throw new Error('Intellect tools require an active repository conversation')
  return agent
}

/** Register scoped operations and reversible presentation contributions. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'intellect_overview',
    description: 'Discover the current repository, durable specifications, verification prerequisites, configured reviewers, and retained runs. No model requests or repository tests are executed.',
    parameters: {}, output,
    presentCall: () => ({ card: 'generic', title: 'Discover specifications and verification readiness' }),
    execute: (_args, exec) => ctx.forgeIntellect.overview(owner(exec.agent), exec.signal),
  }))
  ctx.tools.register(defineTool({
    name: 'intellect_prepare',
    description: 'Prepare a concrete immutable verification plan for the clean current repository revision. Select authoritative REQ, INV, IFC or SCN subjects and relevant source files. Every check is required and must have meaningful success markers from actual test assertions; zero executed tests must not count as success. No tests or models run until intellect_run obtains approval. A whole owner includes all its clauses; TASK is never adherence.',
    parameters: {
      subjects: { type: 'array', required: true, items: { type: 'string' }, description: 'Durable spec IDs, optionally clause anchors. Prefer whole owner scope for attestation.' },
      source_paths: { type: 'array', required: true, items: { type: 'string' }, description: 'Relevant repository-relative source and test files. Native linked source is added automatically.' },
      checks: { type: 'array', required: true, description: 'Fixed checks for the user to review. Do not invent evidence markers.', items: {
        type: 'object', additionalProperties: false, properties: {
          id: { type: 'string', required: true, description: 'Unique lowercase kebab-case check name.' },
          argv: { type: 'array', required: true, items: { type: 'string' }, description: 'Exact executable and arguments; no shell expansion.' },
          obligations: { type: 'array', required: true, items: { type: 'string' }, description: 'Subjects or clauses this check tests.' },
          timeout_seconds: { type: 'integer', required: true, description: 'Positive deadline, at most 3600 seconds.' },
          success_markers: { type: 'array', required: true, items: { type: 'string' }, description: 'All nonempty exact output markers required with exit zero.' },
          failure_markers: { type: 'array', required: true, items: { type: 'string' }, description: 'Markers distinguishing failed assertions from infrastructure failures.' },
        },
      } },
    }, output,
    presentCall: args => ({ card: 'generic', title: 'Prepare verification plan', rawInput: args.subjects.join(', ') }),
    execute: async (args, exec) => z.json().parse(await ctx.forgeIntellect.prepare(owner(exec.agent), args, exec.signal)),
  }))
  ctx.tools.register(defineTool({
    name: 'intellect_run',
    description: 'Present the exact prepared plan for human approval, then start native verification as a background job. Uses the existing Harness credentials. Returns runId and jobId; collect with job_output (wait: true), then intellect_result. Changed or dirty revisions require a new plan. Job completion is separate from implementation support.',
    parameters: { planId: { type: 'string', required: true, description: 'Immutable plan id returned by intellect_prepare.' } }, output,
    presentCall: () => ({ card: 'generic', title: 'Review plan and verify implementation' }),
    execute: (args, exec) => ctx.forgeIntellect.start(owner(exec.agent), args.planId, exec.signal, exec.callId),
  }))
  ctx.tools.register(defineTool({
    name: 'intellect_result',
    description: 'Read authenticated native verification decisions and exact-revision freshness. Supported, contradicted, inconclusive and stale are distinct. A missing artifact fails verification; a successful process is not an attestation.',
    parameters: { runId: runParameter, evidence: { type: 'boolean', description: 'Include authenticated source citations, reviewer findings and executed-check evidence.' } }, output,
    presentCall: () => ({ card: 'generic', title: 'Inspect verification evidence' }),
    execute: (args, exec) => ctx.forgeIntellect.result(owner(exec.agent), args.runId, exec.signal, args.evidence ?? false),
  }))
  ctx.tools.register(defineTool({
    name: 'intellect_reassess',
    description: 'Request fresh independent reviewers over authenticated retained executions. The original code, policy and execution dependencies must still be current. Preserves the original run. New commands, changed code or uncaptured source require a full new run.',
    parameters: { runId: runParameter, planId: { type: 'string', required: true, description: 'Original run plan id from intellect_overview.' } }, output,
    presentCall: () => ({ card: 'generic', title: 'Review retained execution evidence again' }),
    execute: (args, exec) => ctx.forgeIntellect.start(owner(exec.agent), args.planId, exec.signal, exec.callId, args.runId),
  }))
  ctx.tools.register(defineTool({
    name: 'intellect_attest',
    description: 'Ask native Intellect to issue a qualified immutable local attestation. Requires supported complete owner scope, authenticated intact evidence, current clean revision and exact Spec-Ref implements provenance. Never falls back to manual attestation. Does not push Git notes.',
    parameters: { runId: runParameter }, output,
    presentCall: () => ({ card: 'generic', title: 'Record verified implementation attestation' }),
    execute: (args, exec) => ctx.forgeIntellect.attest(owner(exec.agent), args.runId, exec.signal),
  }))
}
