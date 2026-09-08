import { Context } from '@deepseek-ai/cordis'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'
import { probeConfidential } from '@deepseek-ai/node-addon-landlock-run'
import { expect, test } from 'vitest'
import { confidentialToolGuard, registerConfidentialTools } from '../src/confidential-tools.ts'
import { checkConfidentiality } from './fixtures/confidentiality.ts'

test('Forge guard denies late unsafe registrations even when pre-policy allows; generic registry stays unchanged', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(Prompt)
    await ctx.plugin(Tools)
    const remove = ctx.tools.guard(confidentialToolGuard)
    ctx.on('tools/pre-execute', async () => ({ kind: 'allow' as const }))
    let executions = 0
    for (const name of ['grep', 'read_file', 'read_image', 'str_replace_editor', 'bash', 'forge_push_branch', 'forge_shell']) {
      ctx.tools.register(defineTool({ name, description: 'fixture', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() { executions++; return 'executed' } }))
      const result = await ctx.tools.execute({ name, arguments: {}, callId: CallId(name), signal: new AbortController().signal })
      expect(result.isError ?? false).toBe(!['forge_push_branch', 'forge_shell'].includes(name))
    }
    expect(executions).toBe(2)
    remove()
    expect((await ctx.tools.execute({ name: 'grep', arguments: {}, callId: CallId('generic'), signal: new AbortController().signal })).isError).toBeFalsy()
    expect(executions).toBe(3)
    await expect(registerConfidentialTools(ctx, { readRoots: ['/'], workspaceRoot: '/', privateStateFile: '/state/file' }, () => '/'))
      .rejects.toThrow('tools and subprocess')
  } finally { await ctx.fiber.dispose() }
})

test.skipIf(process.platform !== 'linux' || !probeConfidential())('real Loader confines source inspection/edit/commit, synthetic state/proc aliases and alternate tool dispatch', checkConfidentiality, 30_000)
