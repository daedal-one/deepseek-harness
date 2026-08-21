/** Hold a configured number of fully composed Web agents for external memory sampling. */

export const name = 'agent-memory-probe'
export const inject = ['agents', 'agentPresets', 'loader', 'systemPrompt', 'tools']

const MARKER = 'DSH_MEMORY_READY '

function parseCounts(raw) {
  const counts = String(raw ?? '0,1,2,4,8,10')
    .split(',')
    .map(value => Number(value.trim()))
  if (counts.length < 2 || counts[0] !== 0
    || counts.some((value, index) => !Number.isSafeInteger(value) || value < 0
      || (index > 0 && value <= counts[index - 1]))) {
    throw new Error('agent-memory-probe: DSH_MEMORY_AGENT_COUNTS must be an increasing list beginning with 0')
  }
  return counts
}

async function writeMarker(agentCount, toolCount) {
  if (process.env.DSH_MEMORY_FORCE_GC === '1') {
    if (typeof globalThis.gc !== 'function') {
      throw new Error('agent-memory-probe: DSH_MEMORY_FORCE_GC requires Node --expose-gc')
    }
    globalThis.gc()
    await new Promise(resolve => setImmediate(resolve))
    globalThis.gc()
  }
  process.stdout.write(`${MARKER}${JSON.stringify({
    agents: agentCount,
    tools: toolCount,
    node: process.memoryUsage(),
  })}\n`)
}

export function apply(ctx) {
  const counts = parseCounts(process.env.DSH_MEMORY_AGENT_COUNTS)
  const preset = process.env.DSH_MEMORY_AGENT_PRESET?.trim() || 'standard'
  const handles = []
  let nextIndex = 0
  let input = ''
  let advancing = false
  let disposed = false

  async function advance() {
    if (advancing || disposed || nextIndex + 1 >= counts.length) return
    advancing = true
    try {
      const target = counts[++nextIndex]
      while (handles.length < target) {
        const handle = await ctx.agents.create({
          sessionId: `agent-memory-${String(handles.length + 1)}`,
          meta: { cwd: process.cwd() },
          setup: agentCtx => ctx.agentPresets.mount(agentCtx, preset).then(() => undefined),
        })
        handles.push(handle)
        await ctx.systemPrompt.assemble({ scope: handle.agent })
      }
      const toolCount = handles.length === 0 ? 0 : ctx.tools.schemas(handles.at(-1).agent).length
      await writeMarker(handles.length, toolCount)
    } finally {
      advancing = false
    }
  }

  function onInput(chunk) {
    input += chunk
    for (;;) {
      const newline = input.indexOf('\n')
      if (newline < 0) return
      const command = input.slice(0, newline).trim()
      input = input.slice(newline + 1)
      if (command === 'next') {
        void advance().catch((error) => {
          process.stderr.write(`agent-memory-probe: ${error instanceof Error ? error.stack : String(error)}\n`)
          process.exitCode = 1
          setImmediate(() => { throw error })
        })
      }
    }
  }

  process.stdin.setEncoding('utf8')
  process.stdin.on('data', onInput)
  process.stdin.resume()

  void ctx.loader.await().then(() => writeMarker(0, 0)).catch((error) => {
    process.stderr.write(`agent-memory-probe: ${error instanceof Error ? error.stack : String(error)}\n`)
    process.exitCode = 1
  })

  ctx.effect(() => async () => {
    disposed = true
    process.stdin.off('data', onInput)
    process.stdin.pause()
    const results = await Promise.allSettled(handles.reverse().map(handle => handle.dispose()))
    const failures = results
      .filter(result => result.status === 'rejected')
      .map(result => result.reason)
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'agent-memory-probe teardown failed')
  }, 'agent-memory-probe')
}
