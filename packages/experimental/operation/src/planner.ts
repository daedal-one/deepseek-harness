/** Scoped first-plan guidance and an executable foreground-shell example. @module dsh-experimental-operation/planner */

import { validateJsonSchemaValue, type ToolDefinition } from '@deepseek-ai/dsh-tools'

/** Planner guidance for finite evidence collection with ordinary action authority. */
export const PLAN_GUIDANCE = 'Use run_operation for every tool action, as the only tool call in that response. Start with the smallest useful plan; one foreground shell step is often enough for a simple status check. Batch independent read-only checks in that step when appropriate. Use the known Session workspace rather than rediscovering it. Inspect only the facts needed to answer the user; prefer concise summary commands and scoped read windows. Do not clip necessary evidence to fit a budget.\n\n'
  + 'For ordinary actions supply plan:{goal,steps:[{tool,arguments}]} using each action’s ordinary argument object. Omit version, names, IDs, purposes, expression wrappers, assertions, questions and completion: the harness supplies them. Optional step.observe selects complete necessary evidence by JSON Pointer; omit it to observe the complete result. Detailed version-one programs are for actions requiring typed references or custom assertions.\n\n'
  + 'Use short foreground actions and literal small edits. Shell commands and edits must never use output-derived arguments.\n\n'
  + 'After each result, answer when the returned evidence is sufficient for the user request. Do not add speculative checks or expand into repository-wide investigation unless asked. A needs-replan outcome can retain useful completed read evidence: inspect the reason and plan only the missing facts. It does not certify operation completion. Incomplete evidence, uncertainty and failure return control. Never automatically repeat an interrupted mutation.'

const repositoryStatusArguments = {
  command: 'git status --short --branch && git log -1 --oneline',
  description: 'Check branch, worktree changes and latest commit',
} as const
const repositoryStatusPlan = {
  goal: 'Get the branch, worktree changes and latest commit',
  steps: [{ tool: 'bash', arguments: repositoryStatusArguments }],
} as const

/**
 * Show the tested one-step example only for an admitted compatible bash action.
 * @param definitions Complete admitted catalog for this request.
 * @returns Example tool arguments, or no example when the action is unavailable.
 */
export function plannerExample(definitions: readonly ToolDefinition[]): string {
  const bash = definitions.find(definition => definition.name === 'bash')
  if (bash === undefined || validateJsonSchemaValue(bash.parameters, repositoryStatusArguments, '').length > 0) return ''
  const branches = bash.output.schema.oneOf ?? [bash.output.schema]
  if (!branches.some(branch => branch.type === 'object' && branch.properties?.kind?.const === 'foreground'
    && branch.properties.exitCode !== undefined && branch.properties.stdout?.properties?.text?.type === 'string')) return ''
  return '\n\nExample run_operation arguments for a simple repository-status request; adapt to the user\'s actual task:\n\n```json\n'
    + JSON.stringify({ plan: repositoryStatusPlan }) + '\n```'
}
