#!/usr/bin/env node
/** Boot the real bash composition and record lineage-bound credential availability. */

import { writeFile } from 'node:fs/promises'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('tool-bash credential driver requires a config path')

const ctx = await boot('tool-bash-credential-loader-smoke', resolveConfigPath(configPath, undefined))
const text = (result: Awaited<ReturnType<typeof ctx.tools.execute>>): string =>
  result.content.filter(block => block.type === 'text').map(block => block.text).join('')
const execute = async (agent: Agent, callId: string, background = false) => ctx.tools.execute({
  signal: new AbortController().signal,
  callId: ToolCallId(callId),
  name: 'bash',
  arguments: {
    command: 'if test -n "$OPENROUTER_API_KEY"; then printf present; else printf absent; fi',
    description: 'check session-scoped credential',
    ...(background ? { run_in_background: true } : {}),
  },
  agent,
})

try {
  const allowed = await ctx.agents.create({ sessionId: SessionId('loader-root') })
  const denied = await ctx.agents.create({ sessionId: SessionId('loader-outsider') })
  try {
    const allowedForeground = text(await execute(allowed.agent, 'credential-loader-fg'))
    const background = await execute(allowed.agent, 'credential-loader-bg', true)
    const jobId = (background.value as { jobId: string }).jobId
    let allowedBackground = ''
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      allowedBackground += text(await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: ToolCallId('credential-loader-bg-read'),
        name: 'job_output',
        arguments: { job_id: jobId },
        agent: allowed.agent,
      }))
      if (allowedBackground.includes('present') && allowedBackground.includes('[status: completed')) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    const deniedForeground = text(await execute(denied.agent, 'credential-loader-denied'))
    await writeFile('bash-credential-report.json', JSON.stringify({
      allowedForeground,
      allowedBackground,
      deniedForeground,
    }))
  } finally {
    await denied.dispose()
    await allowed.dispose()
  }
} finally {
  await ctx.fiber.dispose()
}
