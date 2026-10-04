/** Keyless external LLM fixture; every artifact action uses ordinary logged tools. */
import { apply as attachWorkspace } from './workspace.ts'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ArtifactRevision, ArtifactPage } from '@deepseek-ai/dsh-artifact/types'
import type {} from '@deepseek-ai/dsh-artifact'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-agent'
class ArtifactFixture extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const results = options.messages.flatMap(message =>
      message.content.filter(block => block.type === 'tool-result'),
    )
    const index = results.length
    const result = (position: number): unknown => {
      const value = results[position]
      if (value === undefined || value.isError)
        throw new Error('Artifact fixture lacks a successful prior tool result.')
      return JSON.parse(
        value.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join(''),
      )
    }
    let name: string | undefined, args: unknown
    const publish = (entry = 'index.html', content = 'Original durable report') => ({
      retry_key: 'durable-create',
      artifact_id: null,
      expected_head: null,
      title: 'Durable report',
      entry,
      profile: 'document',
      assets: [
        {
          name: 'index.html',
          media_type: 'text/html',
          encoding: 'utf8',
          content: '<h1>' + content + '</h1>',
        },
      ],
    })
    if (process.env.DSH_ARTIFACT_FIXTURE_RESTART === '1') {
      if (index === 0) {
        name = 'artifact_list'
        args = { after: null }
      }
      if (index === 1) {
        const page = result(0) as ArtifactPage
        const head = page.items[0]?.head
        if (head === undefined) throw new Error('Cold artifact catalogue is empty.')
        name = 'artifact_read'
        args = {
          artifact_id: head.artifactId,
          revision_id: head.revisionId,
          name: head.entry,
          encoding: 'utf8',
          offset: 0,
          length: 100,
        }
      }
    } else if (index === 0) {
      name = 'artifact_publish'
      args = { ...publish('missing.html'), retry_key: 'invalid-capture' }
    } else if (index === 1 || index === 2) {
      name = 'artifact_publish'
      args = publish()
    } else if (index === 3) {
      const first = result(1) as ArtifactRevision
      name = 'artifact_publish'
      args = {
        ...publish('index.html', 'Updated durable report'),
        retry_key: 'durable-update',
        artifact_id: first.artifactId,
        expected_head: first.revisionId,
      }
    } else if (index === 4) {
      const first = result(1) as ArtifactRevision
      name = 'artifact_publish'
      args = {
        ...publish('index.html', 'Stale overwrite'),
        retry_key: 'stale-update',
        artifact_id: first.artifactId,
        expected_head: first.revisionId,
      }
    } else if (index === 5) {
      const first = result(1) as ArtifactRevision
      const head = result(3) as ArtifactRevision
      name = 'artifact_restore'
      args = {
        retry_key: 'durable-restore',
        artifact_id: first.artifactId,
        revision_id: first.revisionId,
        expected_head: head.revisionId,
      }
    } else if (index === 6) {
      const first = result(1) as ArtifactRevision
      name = 'artifact_read'
      args = {
        artifact_id: first.artifactId,
        revision_id: first.revisionId,
        name: first.entry,
        encoding: 'utf8',
        offset: 0,
        length: 100,
      }
    } else if (index === 7) {
      name = 'artifact_list'
      args = { after: null }
    }
    if (name !== undefined) {
      const id = ToolCallId('artifact-fixture-' + String(index)),
        argumentsText = JSON.stringify(args)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsText }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsText } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      if (
        process.env.DSH_ARTIFACT_FIXTURE_RESTART === '1' &&
        (results[1]?.isError === true ||
          (result(1) as { content: string }).content !== '<h1>Original durable report</h1>')
      )
        throw new Error('Cold artifact bytes did not retain their original content.')
      if (
        process.env.DSH_ARTIFACT_FIXTURE_RESTART !== '1' &&
        (results[0]?.isError !== true || results[4]?.isError !== true)
      )
        throw new Error('Invalid capture and stale write must reject.')
      const text =
        process.env.DSH_ARTIFACT_FIXTURE_RESTART === '1' ? 'ARTIFACT_RESTART_OK' : 'ARTIFACT_COMPOSITION_OK'
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}
export const inject = ['llm', 'agents', 'workspaceRegistry', 'sessions']
/** Register only the external provider and attach its initiating Session to the fixture Workspace. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['artifact-fixture'], new ArtifactFixture())
  attachWorkspace(ctx)
}
