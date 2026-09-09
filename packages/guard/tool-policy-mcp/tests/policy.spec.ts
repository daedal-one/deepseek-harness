import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import ToolPolicyService from '@deepseek-ai/dsh-tool-policy'
import { apply, type Config } from '../src/index.ts'

const base: Config = {
  id: 'mcp',
  rules: [{
    tool: 'mcp__browser__open',
    decision: 'ask',
    risk: 60,
    categories: ['browser'],
    reason: 'navigation requires approval',
    principals: ['browser-reader', 'browser-operator'],
    urlArguments: ['url'],
    forbiddenArguments: ['extraArgs'],
  }],
}

async function mounted(config: Config = base): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(ToolPolicyService, { providers: ['mcp'] })
  apply(ctx, config)
  return ctx
}

function request(toolName: string, args: unknown, principal = 'browser-reader') {
  return {
    toolName,
    arguments: args,
    agent: {
      session: {
        snapshotEvents: () => principal === '' ? [] : [{
          type: 'subagent/descriptor',
          data: { version: 3, mode: 'one-shot', provider: 'spawn', principal },
        }],
      },
    },
    signal: new AbortController().signal,
  } as never
}

describe('tool-policy-mcp', () => {
  it('returns the exact rule and ignores unsupported tools', async () => {
    const ctx = await mounted()
    await expect(ctx.toolPolicy.evaluate(request('mcp__browser__open', {}))).resolves.toMatchObject({
      providerId: 'mcp', decision: 'ask', risk: 60,
    })
    await expect(ctx.toolPolicy.evaluate(request('read', {}))).resolves.toBeUndefined()
  })

  it('rejects deployment-owned arguments before a provider call', async () => {
    const ctx = await mounted()
    await expect(ctx.toolPolicy.evaluate(request('mcp__browser__open', {
      extraArgs: ['--user-data-dir=/tmp/profile'],
    }))).resolves.toMatchObject({ decision: 'deny', categories: ['forbidden-argument'] })
  })

  it('denies root and mismatched agent principals', async () => {
    const ctx = await mounted()
    await expect(ctx.toolPolicy.evaluate(request('mcp__browser__open', {}, ''))).resolves.toMatchObject({
      decision: 'deny', categories: ['principal'],
    })
    await expect(ctx.toolPolicy.evaluate(request('mcp__browser__open', {}, 'researcher'))).resolves.toMatchObject({
      decision: 'deny', categories: ['principal'],
    })
  })

  it('rejects private destinations and accepts a public IP literal', async () => {
    const ctx = await mounted()
    await expect(ctx.toolPolicy.evaluate(request('mcp__browser__open', {
      url: 'http://127.0.0.1/admin',
    }))).resolves.toMatchObject({ decision: 'deny', categories: ['blocked-network'] })
    await expect(ctx.toolPolicy.evaluate(request('mcp__browser__open', {
      url: 'https://1.1.1.1/',
    }))).resolves.toMatchObject({ decision: 'ask', categories: ['browser'] })
    await expect(ctx.toolPolicy.evaluate(request('mcp__browser__open', {
      url: ['https://1.1.1.1/', 'http://127.0.0.1/admin'],
    }))).resolves.toMatchObject({ decision: 'deny', categories: ['blocked-network'] })
    await expect(ctx.toolPolicy.evaluate(request('mcp__browser__open', {
      url: [],
    }))).resolves.toMatchObject({ decision: 'deny', categories: ['invalid-url'] })
  })

  it('fails load on duplicate tools and overlapping argument controls', async () => {
    const ctx = new Context()
    await ctx.plugin(ToolPolicyService, {})
    const rule = base.rules[0]!
    expect(() => {
      apply(ctx, { id: 'mcp', rules: [rule, rule] })
    }).toThrow(/unique tool names/)
    expect(() => {
      apply(ctx, {
        id: 'mcp',
        rules: [{
          tool: rule.tool,
          decision: rule.decision,
          risk: rule.risk,
          categories: rule.categories,
          reason: rule.reason,
          principals: ['browser-reader', 'browser-operator'],
          urlArguments: rule.urlArguments,
          forbiddenArguments: ['url'],
        }],
      })
    }).toThrow(/non-empty and disjoint/)
    expect(() => {
      apply(ctx, {
        id: 'mcp',
        rules: [{
          tool: rule.tool,
          decision: rule.decision,
          risk: rule.risk,
          categories: rule.categories,
          reason: rule.reason,
          principals: [],
          urlArguments: rule.urlArguments,
          forbiddenArguments: rule.forbiddenArguments,
        }],
      })
    }).toThrow(/principals must be non-empty and unique/)
  })
})
