/** Scoped first-plan guidance and an executable foreground-shell example. @module dsh-experimental-operation/planner */

import { validateJsonSchemaValue, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { OperationPlan } from './types.ts'

/** Planner guidance for finite evidence collection with ordinary action authority. */
export const PLAN_GUIDANCE = 'Use run_operation for every tool action, as the only tool call in that response. Start with the smallest useful plan; one foreground shell step is often enough for a simple status check. Batch independent read-only checks in that step when appropriate. Use the known Session workspace rather than rediscovering it. Inspect only the facts needed to answer the user; prefer concise summary commands and scoped read windows. Do not clip necessary evidence to fit a budget.\n\n'
  + 'Supply plan.version:1, name, a specific bounded goal, inputs ({} when unnecessary), nonempty steps, and completion. Wrap fixed action arguments as {kind:"literal",value:{...}}. Each step needs a unique id, purpose, exact admitted tool name, arguments expression, nonempty assertions, observation.paths (JSON Pointers into the canonical result), and a question about its specific evidence. Completion needs nonempty assertions, evidence expressions, and a question about the bounded plan goal. A check of shell exitCode uses {kind:"equals",left:{kind:"result",step:"status",pointer:"/exitCode"},right:{kind:"literal",value:0}}.\n\n'
  + 'Expression kinds are literal, input, result, selected, object and array, as described by the schema; object property values and array items recursively use the same expressions. Argument references point backward only. Shell commands and edits must use literal/input-derived arguments, never previous tool output. Use short foreground actions and literal small edits.\n\n'
  + 'After each result, answer when the returned evidence is sufficient for the user request. Do not add speculative checks or expand into repository-wide investigation unless asked. A needs-replan outcome can retain useful completed read evidence: inspect the reason and plan only the missing facts. It does not certify operation completion. Incomplete evidence, uncertainty and failure return control. Never automatically repeat an interrupted mutation.'

const exitCheck = { kind: 'equals', left: { kind: 'result', step: 'status', pointer: '/exitCode' },
  right: { kind: 'literal', value: 0 } } as const
const repositoryStatusPlan = {
  version: 1, name: 'repository-status', goal: 'Get the branch, worktree changes and latest commit', inputs: {},
  steps: [{ id: 'status', purpose: 'Collect the requested repository status', tool: 'bash',
    arguments: { kind: 'literal', value: { command: 'git status --short --branch && git log -1 --oneline',
      description: 'Check branch, worktree changes and latest commit' } },
    assertions: [exitCheck], observation: { paths: ['/stdout/text'] },
    question: 'Does the output report the branch, worktree changes and latest commit?' }],
  completion: { assertions: [exitCheck], evidence: [{ kind: 'result', step: 'status', pointer: '/stdout/text' }],
    question: 'Have the branch, worktree changes and latest commit been collected?' },
} as const satisfies OperationPlan

/**
 * Show the tested one-step example only for an admitted compatible bash action.
 * @param definitions Complete admitted catalog for this request.
 * @returns Example tool arguments, or no example when the action is unavailable.
 */
export function plannerExample(definitions: readonly ToolDefinition[]): string {
  const bash = definitions.find(definition => definition.name === 'bash')
  if (bash === undefined || validateJsonSchemaValue(bash.parameters, repositoryStatusPlan.steps[0].arguments.value, '').length > 0) return ''
  const branches = bash.output.schema.oneOf ?? [bash.output.schema]
  if (!branches.some(branch => branch.type === 'object' && branch.properties?.kind?.const === 'foreground'
    && branch.properties.exitCode !== undefined && branch.properties.stdout?.properties?.text?.type === 'string')) return ''
  return '\n\nExample run_operation arguments for a simple repository-status request; adapt to the user\'s actual task:\n\n```json\n'
    + JSON.stringify({ plan: repositoryStatusPlan }) + '\n```'
}
