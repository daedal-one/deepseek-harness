import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

const HIGH = ReasoningEffortId('high')
const MINIMAL = ReasoningEffortId('minimal')
const OFF = ReasoningEffortId('off')

/** Keyless headless-agent adapter for the real guarded bash acceptance paths. */
class CliMockAdapter extends LlmAdapter {
  private intentRequests = 0

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      reasoning: {
        efforts: [
          { id: OFF, name: 'Off' },
          { id: MINIMAL, name: 'Minimal' },
          { id: HIGH, name: 'High' },
        ],
        defaultEffort: HIGH,
      },
    }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (process.env.DSH_CLI_MOCK_FAILURE === '1') {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'SERVER', message: 'CLI mock provider failed' } } }
      return
    }
    if (options.provider === 'cli-mock-intent' && options.system?.startsWith('Derive authorization context')) {
      this.intentRequests += 1
      const text = process.env.DSH_CLI_INTENT_RETRY === '1' && this.intentRequests === 1
        ? 'invalid-evidence'
        : 'local-compute\n-\nprove the CLI round trip'
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    if (options.provider === 'cli-mock-intent' || options.provider === 'cli-mock-primary' || options.provider === 'cli-mock-secondary') {
      const text = process.env.DSH_CLI_POLICY_ASK === '1'
        ? 'aligned;network-read'
        : 'aligned;local-compute'
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const toolResult = options.messages
      .findLast(message => message.content.some(block => block.type === 'tool-result'))
      ?.content.find(block => block.type === 'tool-result')
    const priorDaedalAttempt = toolResult === undefined
      ? 0
      : Number(String(toolResult.toolCallId).match(/^cli-smoke-call-(\d+)$/)?.[1] ?? 0)
    const daedalPolicyRetry = process.env.DSH_CLI_DAEDAL === '1'
      && process.env.DSH_CLI_POLICY_ASK === '1'
      && toolResult?.isError === true
      && priorDaedalAttempt > 0
      && priorDaedalAttempt < 3
    if (toolResult === undefined || daedalPolicyRetry) {
      const callId = process.env.DSH_CLI_DAEDAL === '1'
        ? CallId(`cli-smoke-call-${priorDaedalAttempt + 1}`)
        : CallId('cli-smoke-call')
      const args = JSON.stringify({ command: 'printf CLI_TOOL_ROUND_TRIP', description: 'Prove the CLI tool round trip.' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: callId, name: 'bash', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name: 'bash', arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    if (process.env.DSH_CLI_DAEDAL === '1' && String(toolResult.toolCallId).startsWith('cli-smoke-call-')) {
      const args = JSON.stringify({
        scope: 'project',
        statement: 'The assembled Daedal profile completed its guarded shell round trip.',
        evidence: [`snapshot:${toolResult.toolCallId}`],
        trust: 0.9,
      })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: CallId('cli-memory-call'), name: 'memory_propose', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('cli-memory-call'), name: 'memory_propose', arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 13, outputTokens: 4 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    const toolText = toolResult.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    const reply = process.env.DSH_CLI_DAEDAL === '1'
      ? 'Daedal assembled profile completed after a guarded shell call and durable memory proposal.'
      : `CLI tool round trip complete: ${toolText.trim()}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 5, reasoningTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'cli-mock-llm'
export const inject = ['llm']

/** Register the keyless acting and independent policy-review adapters. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['cli-mock', 'cli-mock-intent', 'cli-mock-primary', 'cli-mock-secondary'], new CliMockAdapter())
  ctx.on('agent/request', async ({ step }, next) => {
    const config = await next()
    return step === 2 ? { ...config, reasoningEffort: OFF } : config
  })
}
