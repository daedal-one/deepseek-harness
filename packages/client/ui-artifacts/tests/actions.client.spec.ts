// @vitest-environment jsdom
/** Trusted gesture forwarding refuses incomplete and cancelled view lifetimes. */
import { expect, it, vi } from 'vitest'
import { guardMutation, guardInput, guardDownload, guardAgentRequest } from '../src/client/actions.ts'
import type { ArtifactActionState } from '../src/client/actions.ts'
function ready(): ArtifactActionState {
  return {
    selected: {} as ArtifactActionState['selected'],
    content: {} as ArtifactActionState['content'],
    head: 'head' as never,
    frame: {} as ArtifactActionState['frame'],
    busy: false,
    sourceText: 'Original',
    source: document.createElement('textarea'),
    signal: new AbortController().signal,
  }
}
it('forwards only exact selected metadata from complete live trusted gestures', async () => {
  const state = ready()
  const mutate = vi.fn(async () => {}),
    input = vi.fn(async () => {}),
    download = vi.fn(),
    ask = vi.fn(async () => {})
  await guardMutation(() => state, mutate)('save')
  expect(mutate).toHaveBeenCalledWith('save', state.selected, state.content, state.head)
  const command = { type: 'key', key: 'Enter' } as const
  await guardInput(() => state, input)(command)
  expect(input).toHaveBeenCalledWith(command, state.selected, state.frame)
  guardDownload(() => state, download)()
  expect(download).toHaveBeenCalledWith(state.content)
  await guardAgentRequest(() => state, ask)()
  expect(ask).toHaveBeenCalledWith(state.selected, state.content, state.sourceText, state.source)
})
it.each(['selected', 'content', 'head', 'busy'] as const)(
  'refuses mutation while %s makes its view incomplete',
  async (key) => {
    const state = { ...ready(), [key]: key === 'busy' ? true : null }
    const apply = vi.fn(async () => {})
    await guardMutation(() => state, apply)('restore')
    expect(apply).not.toHaveBeenCalled()
  },
)
it.each(['selected', 'frame', 'busy'] as const)(
  'refuses transient input while %s makes its preview incomplete',
  async (key) => {
    const state = { ...ready(), [key]: key === 'busy' ? true : null }
    const apply = vi.fn(async () => {})
    await guardInput(() => state, apply)({ type: 'text', text: 'Input' })
    expect(apply).not.toHaveBeenCalled()
  },
)
it('refuses export before its exact original content is available', () => {
  const apply = vi.fn()
  guardDownload(() => ({ ...ready(), content: null }), apply)()
  expect(apply).not.toHaveBeenCalled()
})
it.each(['selected', 'content', 'sourceText', 'source'] as const)(
  'refuses an agent request without %s',
  async (key) => {
    const apply = vi.fn(async () => {})
    await guardAgentRequest(() => ({ ...ready(), [key]: null }), apply)()
    expect(apply).not.toHaveBeenCalled()
  },
)
it('retires every previously captured gesture when its pane owner closes', async () => {
  const controller = new AbortController()
  const state = { ...ready(), signal: controller.signal }
  const apply = vi.fn(async () => {})
  const mutation = guardMutation(() => state, apply),
    input = guardInput(() => state, apply),
    download = guardDownload(
      () => state,
      () => {
        void apply()
      },
    ),
    ask = guardAgentRequest(() => state, apply)
  controller.abort()
  await mutation('save')
  await input({ type: 'key', key: 'Tab' })
  download()
  await ask()
  expect(apply).not.toHaveBeenCalled()
})
