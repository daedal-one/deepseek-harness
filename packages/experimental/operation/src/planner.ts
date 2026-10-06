/** Scoped first-plan guidance and an executable foreground-shell example. @module dsh-experimental-operation/planner */

import { validateJsonSchemaValue, type ToolDefinition } from '@deepseek-ai/dsh-tools'

/** Planner guidance for finite evidence collection with ordinary action authority. */
export const PLAN_GUIDANCE = 'Use run_operation for every tool action, as the only tool call in that response. Supply tool and its ordinary arguments from the action catalog below. Add goal only when a short purpose would help. No plan, step IDs, assertions or completion fields are needed for one action.\n\n'
  + 'Start with the smallest useful action. Use the known Session workspace and scoped read/search windows. A foreground shell command may combine independent status checks. Small edits use literal content. Every action must finish in the foreground, including delegated agents.\n\n'
  + 'Use plan:{goal,steps:[{tool,arguments}]} only for a fixed sequence whose arguments you already know. The decision flow may return after any step. Shell commands and edits inside that plan cannot derive their arguments from earlier results.\n\n'
  + 'Read observations and next in every result, including errors. completedSteps already executed even when status is failed or needs-replan. Use their output and answer when you have enough evidence; collect only missing facts. A failed checkpoint does not certify completion and does not undo the action. Never automatically repeat an interrupted or completed mutation. Execution limits belong to the deployment: do not probe or raise them. If output is too large, request a narrower read/search window; do not silently clip necessary evidence.'

const repositoryStatusArguments = {
  command: 'git status --short --branch && git log -1 --oneline',
  description: 'Check branch, worktree changes and latest commit',
} as const
const repositoryStatusRequest = {
  tool: 'bash',
  arguments: repositoryStatusArguments,
  goal: 'Get the branch, worktree changes and latest commit',
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
    + JSON.stringify(repositoryStatusRequest) + '\n```'
}
