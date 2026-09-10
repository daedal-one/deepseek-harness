import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { AgentModelConfig, agentModelTargetId } from '@deepseek-ai/dsh-agent-default-model'
import Subprocess from '@deepseek-ai/dsh-subprocess-local'
import Jobs from '@deepseek-ai/dsh-jobs-local'
import Approval from '@deepseek-ai/dsh-user-approval'
import Intellect, { nativeEnvironment } from '../src/index.ts'
import * as Tools from '../src/tool.ts'

// No credential value or native command is needed to exercise registration ownership.
class CredentialsPresence extends Service {
  constructor(ctx: Context) { super(ctx, 'credentials') }
}
describe('verification integration lifecycle', () => {
  it('removes model targets and scoped tools on disposal, then mounts again', async () => {
    const ctx = new Context()
    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(AgentModelConfig, { provider: 'fixture', model: 'reviewer' })
      await ctx.plugin(Subprocess)
      await ctx.plugin(Jobs)
      await ctx.plugin(Approval)
      await ctx.plugin(CredentialsPresence)
      const target = agentModelTargetId('deadal-intellect-assessor')
      for (let n = 0; n < 2; n++) {
        const service = await ctx.plugin(Intellect, { reviewerProvider: 'fixture', reviewerModel: 'reviewer' })
        const tools = await ctx.plugin(Tools)
        expect(ctx.agentModels.currentSelection(target).model).toBe('reviewer')
        expect(ctx.tools.schemas().filter(t => t.name.startsWith('intellect_'))).toHaveLength(6)
        await tools.dispose()
        expect(ctx.tools.schemas().some(t => t.name.startsWith('intellect_'))).toBe(false)
        await service.dispose()
        expect(() => ctx.agentModels.currentSelection(target)).toThrow(/unknown target/)
      }
    } finally { await ctx.fiber.dispose() }
  })
  it('tombstones unknown ambient variables instead of maintaining a secret-name denylist', () => {
    const key = 'INTELLECT_LIFECYCLE_SECRET'
    process.env[key] = 'hidden'
    try {
      const env = nativeEnvironment()
      expect(env[key]).toBeUndefined()
      expect(Object.hasOwn(env, key)).toBe(true)
      expect(env.PATH).toBe(process.env.PATH)
    } finally { delete process.env.INTELLECT_LIFECYCLE_SECRET }
  })
})
