import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { installLlmReplay } from '@deepseek-ai/dsh-llm-replay'
import { SessionId } from '@deepseek-ai/dsh-session'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-host-webserver'

export const name = 'host-session-admission-probe'
export const inject = ['sessionController', 'agents', 'llm', 'agentPresets', 'tools', 'webServer', 'appReady', 'appExit', 'loader']

interface Config {
  fixture: string
  replay: string
  output: string
  sessionId: string
  task: string
  control: 'resume' | 'bad-digest' | 'unlisted' | 'cancel'
}

export function apply(ctx: Context, config: Config): void {
  let pending: Promise<void> | undefined
  let stopping = false
  const active = new Set<Agent>()
  ctx.effect(() => async () => {
    stopping = true
    for (const agent of active) agent.cancel({ kind: 'disposed' })
    await pending
    await Promise.all([...active].map(agent => agent.whenIdle()))
  })
  ctx.effect(() => ctx.appReady!.onReady(() => {
    pending = run().then(
      () => { if (!stopping) ctx.appExit!(0) },
      (error: unknown) => {
        console.error(error)
        if (!stopping) ctx.appExit!(1)
      },
    )
  }))

  async function run(): Promise<void> {
    const { executionContextForAgent, standingMountFor } = await ctx.loader.import('@deepseek-ai/dsh-agent-presets') as typeof import('@deepseek-ai/dsh-agent-presets')
    const sessionId = SessionId(config.sessionId)
    assert.equal(ctx.agents.get(sessionId), undefined)
    assert(ctx.webServer.port > 0)
    const original = await ctx.sessionController.inspect(sessionId)
    assert.equal(original.meta.agentPreset, 'legacy-host')
    if (config.control === 'bad-digest' || config.control === 'unlisted') {
      await assert.rejects(ctx.sessionController.create({ sessionId, cwd: process.cwd() }),
        config.control === 'bad-digest' ? /prefix digest mismatch/ : /requires its own session admission/)
      assert.equal(ctx.agents.get(sessionId), undefined)
      await writeFile(config.output, JSON.stringify({ refused: config.control, port: ctx.webServer.port }))
      return
    }

    const created = await ctx.sessionController.create({ sessionId, cwd: process.cwd() })
    assert.equal(created.sessionId, sessionId)
    assert.equal(created.agentPreset, 'legacy-host')
    const agent = ctx.agents.get(sessionId)!
    active.add(agent)
    assert.deepEqual(agent.session.header, original.meta)
    assert.deepEqual(agent.session.snapshotEvents().slice(0, original.events.length), original.events)
    assert.equal(agent.session.snapshotEvents().some(event => event.type === 'agent-preset/selected'), false)
    const mount = standingMountFor(agent.ctx)!
    assert.equal(mount.logicalPresetId, 'legacy-host')
    assert.equal(mount.compositionPresetId, 'host-wrapper')
    assert.equal(mount.variant, 'admitted')
    const execution = executionContextForAgent(ctx, agent)
    const consumer = [...mount.tree.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-tool-bash')!
    assert(consumer.fiber?.store?.shell)
    assert(consumer.fiber.store.shell.fiber.ctx === execution, 'primary helper must return the real consumer shell provider context')
    assert.equal(consumer.fiber.ctx[Context.isolate].shell, execution[Context.isolate].shell)
    for (const name of ['fs', 'subprocess', 'shell'] as const) {
      assert.equal(execution.get(name)?.executionWorld, Symbol.for('@deepseek-ai/dsh/host-execution-world'))
      assert.notEqual(execution[Context.isolate][name], ctx[Context.isolate][name], `${name} must be isolated from the root provider`)
    }
    const beforePolicies = original.events.filter(event => ['permission/preset', 'sandbox/mode', 'approval/policy'].includes(event.type))
    assert.deepEqual(agent.session.snapshotEvents().filter(event => ['permission/preset', 'sandbox/mode', 'approval/policy'].includes(event.type)), beforePolicies)
    const requests: GenerateOptions[] = []
    const removeCapture = ctx.on('llm/stream', (request, next) => {
      requests.push(request)
      return next()
    })
    const continueAgent = async (target: Agent): Promise<void> => {
      const replay = installLlmReplay(ctx, {
        file: config.fixture,
        overrideFile: config.replay,
        providers: [{ id: 'snapshot', models: [{ id: 'replay', contextWindow: 16384 }] }],
      })
      try {
        let cancelObserved = false
        const removeCancellation = ctx.on('agent/assistant-stream', ({ agent: streaming, frame }) => {
          if (config.control !== 'cancel' || streaming !== target || frame.type !== 'start') return
          cancelObserved = true
          ctx.sessionController.cancel({ sessionId: target.id })
        })
        try {
          await ctx.sessionController.prompt({
            sessionId: target.id,
            requestId: 'host-admission-continuation' as SessionRequestId,
            mode: 'queue',
            content: [{ type: 'text', text: config.task }],
          }, new AbortController().signal)
          await target.whenIdle()
          const end = target.session.snapshotEvents().findLast(event => event.type === 'turn/end')!
          assert.equal(end.data.reason.kind, config.control === 'cancel' ? 'aborted' : 'completed')
          if (config.control === 'cancel') assert.equal(cancelObserved, true)
          replay.assertConsumed()
        } finally {
          removeCancellation()
        }
      } finally {
        replay.dispose()
      }
    }
    try {
      await continueAgent(agent)
      assert.equal(requests.length, 1)
      assert(JSON.stringify(requests[0]!.messages).includes('LEGACY_HOST_ACK'))
      const surface = (request: GenerateOptions) => ({
        system: request.messages.filter(message => message.role === 'system').map(message => message.content),
        tools: request.tools,
      })
      if (config.control === 'resume') {
        const ordinary = await ctx.sessionController.create({ sessionId: SessionId('ordinary-logical-counterpart'), cwd: process.cwd(), agentPreset: 'legacy-host' })
        const counterpart = ctx.agents.get(ordinary.sessionId)!
        active.add(counterpart)
        assert.equal(standingMountFor(counterpart.ctx)?.variant, 'ordinary')
        assert.equal(executionContextForAgent(ctx, counterpart)[Context.isolate].shell, ctx[Context.isolate].shell)
        setApprovalPolicy(counterpart.session, 'never')
        await continueAgent(counterpart)
        assert.equal(requests.length, 2)
        assert.deepEqual(surface(requests[0]!), surface(requests[1]!))
        const runtimeContext = (request: GenerateOptions) => request.messages
          .filter(message => message.source.kind === 'plugin' && message.source.plugin === '@deepseek-ai/dsh-system-prompt' && message.role !== 'system')
          .map(message => message.content)
        assert.deepEqual(runtimeContext(requests[0]!), runtimeContext(requests[1]!))
      }
      assert.equal(agent.session.snapshotEvents().some(event => event.type === 'tool/call'), false)
      assert.deepEqual(agent.session.snapshotEvents().slice(0, original.events.length), original.events)
      await writeFile(config.output, JSON.stringify({
        port: ctx.webServer.port,
        logicalPreset: mount.logicalPresetId,
        compositionPreset: mount.compositionPresetId,
        realConsumer: consumer.options.name,
        isolatedHost: true,
        request: surface(requests[0]!),
        canceled: config.control === 'cancel',
        requests: requests.length,
      }))
    } finally {
      removeCapture()
    }
  }
}
