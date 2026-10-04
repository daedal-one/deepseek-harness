/** Attach the initiating fixture Session through the ordinary durable Workspace registry. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
export const inject = ['agents', 'workspaceRegistry', 'sessions']
/** Install the fixture's durable Workspace attachment before each model request. */
export function apply(ctx: Context): void {
  ctx.on('agent/request', async (_request, next) => {
    const agent = ctx.agents.requireInitiator()
    if (!(await ctx.sessions.flush(agent.session))) throw new Error('Fixture Session did not checkpoint.')
    const workspace = await ctx.workspaceRegistry.create(process.cwd())
    await workspace.attachSession(agent.id)
    return next()
  })
}
