/** Keyless model control; reference edits still pass through the production editor. */

import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { join } from 'node:path'
import { taskById } from './tasks.ts'
import type { DeliveryVariant } from './types.ts'

interface ScriptConfig {
  readonly task: string
  readonly behavior: DeliveryVariant['scriptedBehavior']
}

class ScriptedAdapter extends LlmAdapter {
  private stage = 0
  constructor(private readonly config: ScriptConfig) { super() }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: 'Scripted coding control', contextWindow: 128_000 })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.config.behavior === 'hang') {
      await new Promise<void>((resolve) => {
        if (options.signal?.aborted) resolve()
        else options.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      return
    }
    const stage = this.stage++
    if (this.config.behavior === 'fail' || (this.config.behavior === 'repair' && stage === 0)) {
      yield* finalReply()
      return
    }
    const effectiveStage = this.config.behavior === 'repair' ? stage - 1 : stage
    const task = taskById(this.config.task)
    if (effectiveStage >= 2) {
      yield* finalReply()
      return
    }
    const edits = Object.entries(task.solution)
    const calls = effectiveStage === 0
      ? Object.keys(task.files).map(path => ({ command: 'view', path: join(process.cwd(), path) }))
      : edits.map(([path, text]) => task.files[path] === undefined
        ? { command: 'create', path: join(process.cwd(), path), file_text: text }
        : { command: 'str_replace', path: join(process.cwd(), path), old_str: task.files[path], new_str: text })
    for (const [index, args] of calls.entries()) {
      const id = ToolCallId(`coding-${stage}-${index}`)
      const argumentsText = JSON.stringify(args)
      yield { type: 'block-start', index, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index, id, name: 'str_replace_editor', argumentsDelta: argumentsText }
      yield { type: 'block-end', index, block: { type: 'tool-call', id, name: 'str_replace_editor', arguments: argumentsText } }
    }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}

function* finalReply(): Iterable<StreamChunk> {
  const text = 'The candidate is ready for independent verification.'
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** Loader plugin identity. */
export const name = 'coding-delivery-scripted-model'
/** The adapter requires the production request registry. */
export const inject = ['llm']

/** Register a validated, trial-scoped scripted route with effect-owned disposal. */
export function apply(ctx: Context, config: ScriptConfig): void {
  taskById(config.task)
  if (!['solve', 'repair', 'fail', 'hang'].includes(config.behavior)) throw new Error('invalid coding benchmark behavior')
  ctx.effect(() => ctx.llm.registerAdapter(['coding-bench'], new ScriptedAdapter(config)))
}
