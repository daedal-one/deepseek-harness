/** Model-facing requests for user-approved environment repository access. @module */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from './workspaces.ts'

export const name = 'tool-request-repo-access'
export const inject = ['tools', 'conversationWorkspaces', 'userQuestions']

/** Register the repository access tool against the initiating session's environment.
 * @param ctx - tool registry, environment workspace owner, and human question provider.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'request_repo_access',
    description: 'Request access to a Git repository and attach an isolated checkout. The environment may allow any HTTPS remote, including repositories without a server checkout. New access requires an explicit user decision. Fetch permits reading the remote; push also permits writing to it. The grant applies to other sessions in this environment until it expires or is revoked. Request access only when the user’s task needs this repository.',
    parameters: {
      repository: { type: 'string', required: true, description: 'Exact credential-free HTTPS Git repository URL.' },
      access: { type: 'string', enum: ['fetch', 'push'], required: true, description: 'Required remote access. Request push only when the user explicitly wants remote writes.' },
      reason: { type: 'string', required: true, description: 'Explain why the user’s task requires this repository and access level.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        status: { type: 'string', enum: ['ready', 'denied', 'approved_pending'], required: true },
        repository: { type: 'string', required: true }, access: { type: 'string', enum: ['fetch', 'push'], required: true },
        environmentId: { type: 'string', required: true }, path: { type: 'string' }, error: { type: 'string' },
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('repository access requires an initiating session')
      return await ctx.conversationWorkspaces.requestRepository(exec.agent, args.repository, args.access, args.reason, exec.signal)
    },
  }))
}
