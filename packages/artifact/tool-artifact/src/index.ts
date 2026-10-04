/** Model-facing artifact operations through the ordinary guarded tool pipeline. @module */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ArtifactId, ArtifactOperationId, ArtifactRevisionId } from '@deepseek-ai/dsh-artifact'
import type {} from '@deepseek-ai/dsh-artifact'
import type {} from '@deepseek-ai/dsh-workspace'
export const name = 'tool-artifact'
export const inject = ['tools', 'artifacts', 'workspaceRegistry']
/** Complete model-visible result cap and cooperative operation deadline. */
export interface Config {
  /** Maximum complete JSON text emitted as one tool result. */
  maxResultBytes: number
  /** Guarded tool execution deadline in milliseconds. */
  timeoutMs: number
}
/** Positive deployment limits, checked before publishing tool results. */
export const Config: z<Config> = z.object({
  maxResultBytes: z.number().step(1).min(1).required(),
  timeoutMs: z.number().step(1).min(1).required(),
})
const nullableId = { oneOf: [{ type: 'string' }, { type: 'null' }], required: true } as const
const output = {
  type: 'object',
  additionalProperties: false,
  properties: { json: { type: 'string', required: true } },
} as const
/**
 * Register publication, bounded discovery, exact revision reads, and immutable restoration.
 * @param ctx - tool registry and authoritative artifact service.
 * @param config - complete model-output bounds.
 */
export function apply(ctx: Context, config: Config): void {
  const result = (value: unknown): { json: string } => {
    const json = JSON.stringify(value)
    if (Buffer.byteLength(json) > config.maxResultBytes)
      throw new Error('Artifact result exceeds the model-output limit. Request a smaller text range.')
    return { json }
  }
  const sessionOf = (exec: ToolRunContext) => {
    if (exec.agent === undefined) throw new Error('Artifact operations require an owning agent Session.')
    exec.signal.throwIfAborted()
    return exec.agent.session
  }
  const workspaceOf = (exec: ToolRunContext) => {
    const session = sessionOf(exec)
    const matches = ctx.workspaceRegistry
      .list()
      .filter(workspace => workspace.sessionIds.includes(session.id))
    const workspace = matches[0]
    if (matches.length !== 1 || workspace === undefined)
      throw new Error('Artifact operations require one durable Workspace attachment.')
    return workspace.id
  }
  const operationId = (key: string): ArtifactOperationId => {
    if (key.trim().length === 0) throw new Error('Artifact retry key is required.')
    const digest = createHash('sha256').update(key).digest('hex')
    return (digest.slice(0, 8) +
      '-' +
      digest.slice(8, 12) +
      '-5' +
      digest.slice(13, 16) +
      '-a' +
      digest.slice(17, 20) +
      '-' +
      digest.slice(20, 32)) as ArtifactOperationId
  }
  const render = (_args: unknown, value: { json: string }) => [{ type: 'text' as const, text: value.json }]
  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'artifact_publish',
          description:
            'Publish a durable artifact in the current Workspace. Supply the complete entry and explicit assets; nothing is discovered from files or URLs. New artifacts use null artifact_id and expected_head. Updates must use the current revision as expected_head and never overwrite history. Document artifacts cannot execute authored code. Interactive-local artifacts have only published assets and transient input: no network, files, credentials, agent, tools, or persistent storage. Execution can be unavailable on an unqualified host. Choose a stable retry_key and repeat the exact key and input after an uncertain result.',
          parameters: {
            retry_key: { type: 'string', required: true },
            artifact_id: nullableId,
            expected_head: nullableId,
            title: { type: 'string', required: true },
            entry: { type: 'string', required: true },
            profile: { type: 'string', enum: ['document', 'interactive-local'], required: true },
            assets: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', required: true },
                  media_type: { type: 'string', required: true },
                  encoding: { type: 'string', enum: ['utf8', 'base64'], required: true },
                  content: { type: 'string', required: true },
                },
              },
            },
          },
          output: { schema: output, render },
          timeoutMs: config.timeoutMs,
          async execute(args, exec) {
            const revision = await ctx.artifacts.publish(sessionOf(exec), {
              operationId: operationId(args.retry_key),
              artifactId: args.artifact_id as ArtifactId | null,
              expectedHead: args.expected_head as ArtifactRevisionId | null,
              title: args.title,
              entry: args.entry,
              profile: args.profile,
              assets: args.assets.map(asset => ({
                name: asset.name,
                mediaType: asset.media_type,
                data:
                  asset.encoding === 'utf8' ? Buffer.from(asset.content).toString('base64') : asset.content,
              })),
            })
            return result(revision)
          },
          presentCall: args => ({
            card: 'generic',
            title: 'Publish artifact',
            kind: 'other',
            rawInput: { title: args.title, entry: args.entry, profile: args.profile },
          }),
        }),
      ),
    'artifacts.publishTool',
  )
  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'artifact_list',
          description:
            'List a bounded page of durable artifacts from the current Workspace, including inactive and archived conversations. Reuse the next cursor for the following page.',
          parameters: { after: nullableId },
          output: { schema: output, render },
          timeoutMs: config.timeoutMs,
          async execute(args, exec) {
            return result(await ctx.artifacts.list(workspaceOf(exec), args.after as ArtifactId | null))
          },
          isConcurrencySafe: () => true,
        }),
      ),
    'artifacts.listTool',
  )
  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'artifact_read',
          description:
            'Read an exact immutable artifact revision asset in the current Workspace. Text reads return a bounded range in Unicode characters; base64 reads return the complete original bytes subject to the result cap.',
          parameters: {
            artifact_id: { type: 'string', required: true },
            revision_id: { type: 'string', required: true },
            name: { type: 'string', required: true },
            encoding: { type: 'string', enum: ['utf8', 'base64'], required: true },
            offset: { type: 'integer', required: true },
            length: { type: 'integer', required: true },
          },
          output: { schema: output, render },
          timeoutMs: config.timeoutMs,
          async execute(args, exec) {
            if (
              !Number.isSafeInteger(args.offset) ||
              args.offset < 0 ||
              !Number.isSafeInteger(args.length) ||
              args.length <= 0
            )
              throw new Error('Artifact text range requires a non-negative offset and positive length.')
            const content = await ctx.artifacts.read(
              workspaceOf(exec),
              args.artifact_id as ArtifactId,
              args.revision_id as ArtifactRevisionId,
              args.name,
              exec.signal,
            )
            const bytes = Buffer.from(content.data, 'base64')
            const text =
              args.encoding === 'utf8'
                ? new TextDecoder('utf-8', { fatal: true }).decode(bytes)
                : content.data
            const characters = Array.from(text)
            return result({
              revision: content.revision,
              name: content.asset.name,
              encoding: args.encoding,
              content:
                args.encoding === 'base64'
                  ? text
                  : characters.slice(args.offset, args.offset + args.length).join(''),
              totalCharacters: characters.length,
            })
          },
          isConcurrencySafe: () => true,
        }),
      ),
    'artifacts.readTool',
  )
  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'artifact_restore',
          description:
            'Restore an immutable revision by creating a new head, preserving all history. expected_head must be the current revision. Repeat the same retry_key to recover an uncertain result.',
          parameters: {
            artifact_id: { type: 'string', required: true },
            revision_id: { type: 'string', required: true },
            expected_head: { type: 'string', required: true },
            retry_key: { type: 'string', required: true },
          },
          output: { schema: output, render },
          timeoutMs: config.timeoutMs,
          async execute(args, exec) {
            return result(
              await ctx.artifacts.restore(
                sessionOf(exec),
                args.artifact_id as ArtifactId,
                args.revision_id as ArtifactRevisionId,
                args.expected_head as ArtifactRevisionId,
                operationId(args.retry_key),
              ),
            )
          },
          presentCall: args => ({
            card: 'generic',
            title: 'Restore artifact revision',
            kind: 'other',
            rawInput: { artifactId: args.artifact_id, revisionId: args.revision_id },
          }),
        }),
      ),
    'artifacts.restoreTool',
  )
}
