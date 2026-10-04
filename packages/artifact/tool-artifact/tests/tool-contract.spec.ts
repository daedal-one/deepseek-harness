/** Model publication, bounded output and owner authority through the real tool runtime. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ArtifactRevision } from '@deepseek-ai/dsh-artifact'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as Plugin from '../src/index.ts'
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})
async function harness(maxResultBytes = 65536) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Sessions)
  await ctx.plugin(Tools)
  const session = ctx.sessions.create(SessionId('publisher'))
  const workspaces = [{ id: 'workspace', sessionIds: [session.id] }]
  ctx.provide('workspaceRegistry', { list: () => workspaces } as never)
  const revision = { artifactId: 'artifact', revisionId: 'revision', title: 'Title' } as ArtifactRevision
  const publish = vi.fn(async () => revision),
    restore = vi.fn(async () => revision)
  const list = vi.fn(async () => ({ items: [{ head: revision, revisionCount: 1 }], next: null }))
  const read = vi.fn(async () => ({
    revision,
    asset: { name: 'index.txt' },
    data: Buffer.from('A🌍B').toString('base64'),
  }))
  ctx.provide('artifacts', { publish, restore, list, read } as never)
  const fiber = ctx.plugin(Plugin, { maxResultBytes, timeoutMs: 10000 })
  await fiber
  let sequence = 0
  const agent = { session } as Agent
  const execute = (
    name: string,
    argumentsValue: Record<string, unknown>,
    owner: Agent | undefined = agent,
    signal = new AbortController().signal,
  ) =>
    ctx.tools.execute({
      callId: ToolCallId('call-' + String(++sequence)),
      name,
      arguments: argumentsValue,
      agent: owner,
      signal,
    })
  return { ctx, fiber, execute, session, workspaces, publish, restore, list, read, revision }
}
const input = {
  retry_key: 'stable retry',
  artifact_id: null,
  expected_head: null,
  title: 'Title',
  entry: 'index.txt',
  profile: 'document',
  assets: [
    { name: 'index.txt', media_type: 'text/plain', encoding: 'utf8', content: 'A🌍B' },
    { name: 'image.png', media_type: 'image/png', encoding: 'base64', content: 'AA==' },
  ],
}
it('publishes exact complete assets and deterministic retry identities without discovering files', async () => {
  const h = await harness()
  expect((await h.execute('artifact_publish', input)).isError).toBe(false)
  expect((await h.execute('artifact_publish', input)).isError).toBe(false)
  const calls = h.publish.mock.calls as unknown as [unknown, { operationId: string; assets: unknown[] }][]
  expect(calls[0]).toEqual(calls[1])
  expect(calls[0]![0]).toBe(h.session)
  expect(calls[0]![1]).toMatchObject({
    title: 'Title',
    profile: 'document',
    assets: [
      { name: 'index.txt', mediaType: 'text/plain', data: Buffer.from('A🌍B').toString('base64') },
      { name: 'image.png', mediaType: 'image/png', data: 'AA==' },
    ],
  })
  expect(calls[0]![1].operationId).toMatch(
    /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/u,
  )
  expect(h.ctx.tools.get('artifact_publish')!.presentCall?.(input)).toMatchObject({
    title: 'Publish artifact',
    rawInput: { title: 'Title', entry: 'index.txt', profile: 'document' },
  })
  await h.fiber.dispose()
  expect(h.ctx.tools.get('artifact_publish')).toBeUndefined()
  expect(h.ctx.tools.get('artifact_list')).toBeUndefined()
})
it('projects a Workspace catalogue and Unicode character ranges while preserving exact revision metadata', async () => {
  const h = await harness()
  const listed = await h.execute('artifact_list', { after: null })
  expect(listed.isError).toBe(false)
  expect(h.list).toHaveBeenCalledWith('workspace', null)
  const args = {
    artifact_id: 'artifact',
    revision_id: 'revision',
    name: 'index.txt',
    encoding: 'utf8',
    offset: 1,
    length: 1,
  }
  const read = await h.execute('artifact_read', args)
  expect(read.content).toMatchObject([
    {
      type: 'text',
      text: JSON.stringify({
        revision: h.revision,
        name: 'index.txt',
        encoding: 'utf8',
        content: '🌍',
        totalCharacters: 3,
      }),
    },
  ])
  expect(h.read).toHaveBeenCalledWith(
    'workspace',
    'artifact',
    'revision',
    'index.txt',
    expect.any(AbortSignal),
  )
  const binary = await h.execute('artifact_read', { ...args, encoding: 'base64' })
  expect(binary.content).toHaveLength(1)
  const part = binary.content[0]!
  if (part.type !== 'text') throw new Error('Binary artifact read requires a text response.')
  expect(part.text).toContain(Buffer.from('A🌍B').toString('base64'))
  expect(h.ctx.tools.get('artifact_list')!.isConcurrencySafe?.({ after: null })).toBe(true)
  expect(h.ctx.tools.get('artifact_read')!.isConcurrencySafe?.(args)).toBe(true)
})
it('restores using exact observed history and the same retry-key mapping', async () => {
  const h = await harness()
  const args = {
    artifact_id: 'artifact',
    revision_id: 'old',
    expected_head: 'current',
    retry_key: 'restore-key',
  }
  expect((await h.execute('artifact_restore', args)).isError).toBe(false)
  expect(h.restore).toHaveBeenCalledWith(h.session, 'artifact', 'old', 'current', expect.any(String))
  expect(h.ctx.tools.get('artifact_restore')!.presentCall?.(args)).toMatchObject({
    title: 'Restore artifact revision',
    rawInput: { artifactId: 'artifact', revisionId: 'old' },
  })
})
it('refuses missing owner, ambiguous Workspace and empty retry key without invoking the provider', async () => {
  const h = await harness()
  const missing = await h.ctx.tools.execute({
    callId: ToolCallId('missing'),
    name: 'artifact_publish',
    arguments: input,
    signal: new AbortController().signal,
  })
  expect(missing.isError).toBe(true)
  expect((await h.execute('artifact_publish', { ...input, retry_key: ' ' })).isError).toBe(true)
  expect(h.publish).not.toHaveBeenCalled()
  h.workspaces.push({ id: 'other', sessionIds: [h.session.id] })
  expect((await h.execute('artifact_list', { after: null })).isError).toBe(true)
  expect(h.list).not.toHaveBeenCalled()
})
it.each([
  { offset: -1, length: 1 },
  { offset: 0, length: 0 },
  { offset: Number.MAX_SAFE_INTEGER + 1, length: 1 },
  { offset: 0, length: Number.MAX_SAFE_INTEGER + 1 },
])('refuses invalid text range %j', async (range) => {
  const h = await harness()
  const result = await h.execute('artifact_read', {
    artifact_id: 'artifact',
    revision_id: 'revision',
    name: 'index.txt',
    encoding: 'utf8',
    ...range,
  })
  expect(result.isError).toBe(true)
  expect(h.read).not.toHaveBeenCalled()
})
it('refuses complete model output above its cap and propagates invalid UTF-8', async () => {
  const h = await harness(1)
  expect((await h.execute('artifact_publish', input)).isError).toBe(true)
  expect(h.publish).toHaveBeenCalledOnce()
  const read = await harness()
  read.read.mockResolvedValueOnce({ revision: read.revision, asset: { name: 'index.txt' }, data: '/w==' })
  expect(
    (
      await read.execute('artifact_read', {
        artifact_id: 'artifact',
        revision_id: 'revision',
        name: 'index.txt',
        encoding: 'utf8',
        offset: 0,
        length: 1,
      })
    ).isError,
  ).toBe(true)
})
