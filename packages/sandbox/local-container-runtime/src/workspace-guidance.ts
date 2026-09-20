/** Logged coding guidance for conversation repositories. @module */
import type { Agent } from '@deepseek-ai/dsh-agent'

/** Add ordinary Git guidance without exposing workspace transport to the agent.
 * @param agent - prepared conversation agent with a scoped prompt service.
 */
export function installWorkspaceGuidance(agent: Agent): void {
  agent.ctx.systemPrompt.section({
    name: 'workspace:commits',
    order: agent.ctx.systemPrompt.getSectionOrder('HARNESS_IDENTITY') + 1,
    text: 'Make granular commits as coherent changes are completed. Commit only changes within the requested task scope. Leave the working tree in the best recoverable state when stopping.',
  })
}
