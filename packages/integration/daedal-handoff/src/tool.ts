/** Daedal-preset-only execution guidance and handoff tool. @module */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from './index.ts'
import { isHostExecution } from './world.ts'

export const name = 'daedal-handoff-tool'
export const inject = ['tools', 'systemPrompt', 'fs', 'subprocess']

/** Install only in Daedal preset scopes. @param ctx - preset-owned registration context. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.context({
    name: 'daedal:execution', order: ctx.systemPrompt.getContextOrder('SANDBOX_POLICY') + 2,
    text: ({ agent }) => {
      return isHostExecution(ctx, agent)
        ? 'Execution environment: host. Files and commands use this host profile and its permissions. Perform authorized host maintenance here; do not request another host handoff.'
        : 'Execution environment: isolated workspace. Workspace file and shell tools operate in isolation. Their paths, processes, and localhost do not identify the host running the harness. Permission changes cannot move this session onto the host. For updating or restarting the running harness, managing host services, or inspecting host-only files or processes, stop and call handoff_to_host with the complete task, committed branch or revision, and remaining steps. Do not search guessed host paths, probe host processes, retry blocked localhost requests, or invent unavailable tools. The action asks the user to confirm a separate host session. If unavailable or declined, report that and stop host work. Delegated agents must report the required handoff to their parent. After successful handoff, continue that work only in the destination session.'
    },
  })
  ctx.tools.register(defineTool({
    name: 'handoff_to_host',
    description: 'Request explicit user confirmation to transfer host-maintenance work from this isolated Daedal workspace to a new session on the configured host. Supply the complete task, relevant committed branch or revision, completed checks, and remaining steps. Use this as the only tool call in the response. It never changes this session’s execution environment or permissions.',
    parameters: {
      title: { type: 'string', required: true, description: 'Short title for the host task.' },
      task: { type: 'string', required: true, description: 'Complete task summary for user review and transfer, including committed work, checks, and remaining host steps. Exclude secrets.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        status: { type: 'string', required: true }, message: { type: 'string', required: true },
        sessionId: { type: 'string' }, destination: { type: 'string' }, destinationUrl: { type: 'string' },
      } },
      render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }],
    },
    presentCall: args => ({ card: 'generic', title: 'Request host handoff', kind: 'other', rawInput: args }),
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('Host handoff requires a live Daedal session')
      if (isHostExecution(ctx, exec.agent)) {
        throw new Error('This session already runs on the host; perform authorized maintenance here.')
      }
      const handoff = ctx.get('daedalHandoff')
      if (handoff === undefined) return { status: 'unavailable', message: 'Host handoff is not configured. Ask the user to start a separate host-maintenance session. Do not attempt host work here.' }
      return handoff.handoff(exec.agent, exec.callId, args, exec.signal)
    },
  }))
}
