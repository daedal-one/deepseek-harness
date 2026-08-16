import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import ToolPolicyService, { ToolPolicyProviderId } from '../src/index.ts'

describe('ToolPolicyService', () => {
  it('selects exactly one provider and disposal removes it', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(ToolPolicyService, {})
    await fiber
    const dispose = ctx.toolPolicy.register(ToolPolicyProviderId('only'), { evaluate: async () => undefined })
    await expect(ctx.toolPolicy.evaluate({} as never)).resolves.toBeUndefined()
    expect(() => ctx.toolPolicy.register(ToolPolicyProviderId('only'), { evaluate: async () => undefined })).toThrow(/duplicate/)
    dispose()
    await expect(ctx.toolPolicy.evaluate({} as never)).rejects.toThrow(/no providers/)
    await fiber.dispose()
  })

  it('uses an explicitly configured provider', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(ToolPolicyService, { providers: ['b'] })
    await fiber
    ctx.toolPolicy.register(ToolPolicyProviderId('a'), { evaluate: async () => undefined })
    ctx.toolPolicy.register(ToolPolicyProviderId('b'), { evaluate: async () => ({
      providerId: ToolPolicyProviderId('b'), decision: 'allow', risk: 0, categories: [], reason: 'safe', opinions: [],
    }) })
    await expect(ctx.toolPolicy.evaluate({} as never)).resolves.toMatchObject({ providerId: 'b' })
    await fiber.dispose()
  })

  it('routes across configured providers and combines overlapping verdicts conservatively', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(ToolPolicyService, { providers: ['shell', 'mcp'] })
    await fiber
    ctx.toolPolicy.register(ToolPolicyProviderId('shell'), { evaluate: async request => request.toolName === 'bash'
      ? { providerId: ToolPolicyProviderId('shell'), decision: 'allow', risk: 5, categories: ['shell'], reason: 'safe', opinions: [] }
      : undefined })
    ctx.toolPolicy.register(ToolPolicyProviderId('mcp'), { evaluate: async request => request.toolName === 'bash'
      ? { providerId: ToolPolicyProviderId('mcp'), decision: 'ask', risk: 70, categories: ['external'], reason: 'confirm', opinions: [] }
      : undefined })

    await expect(ctx.toolPolicy.evaluate({ toolName: 'bash' } as never)).resolves.toMatchObject({
      providerId: 'tool-policy', decision: 'ask', risk: 70,
    })
    await expect(ctx.toolPolicy.evaluate({ toolName: 'read' } as never)).resolves.toBeUndefined()
    await fiber.dispose()
  })
})
