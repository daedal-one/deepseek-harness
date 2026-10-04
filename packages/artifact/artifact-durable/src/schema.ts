/** Durable manifest validation and ledger format. @module */
import { z } from 'zod'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import type {
  ArtifactRevision,
  ArtifactId,
  ArtifactRevisionId,
  ArtifactOperationId,
} from '@deepseek-ai/dsh-artifact'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { AttachmentIdType } from '@deepseek-ai/dsh-attachment'
const uuid = z.uuid()
const artifactId = uuid.transform(value => value as ArtifactId)
const revisionId = uuid.transform(value => value as ArtifactRevisionId)
const workspaceId = z
  .string()
  .min(1)
  .transform(value => value as WorkspaceId)
const sessionId = z
  .string()
  .min(1)
  .transform(value => value as SessionId)
const operationId = uuid.transform(value => value as ArtifactOperationId)
/** Closed manifest schema read from durable storage. */
export const revisionSchema: z.ZodType<ArtifactRevision> = z
  .strictObject({
    artifactId,
    revisionId,
    workspaceId,
    sessionId,
    operationId,
    parent: revisionId.nullable(),
    restoredFrom: revisionId.nullable(),
    title: z.string().refine(value => value.trim().length > 0, 'Title is empty.'),
    entry: z.string().min(1),
    profile: z.enum(['document', 'interactive-local']),
    capabilities: z.union([
      z.tuple([z.literal('published-assets')]),
      z.tuple([z.literal('published-assets'), z.literal('transient-input')]),
    ]),
    assets: z.array(
      z.strictObject({
        name: z.string().regex(/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*(?:\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*)*$/u),
        mediaType: z.enum([
          'text/html',
          'text/markdown',
          'text/plain',
          'text/css',
          'text/javascript',
          'application/json',
          'image/png',
          'image/jpeg',
          'image/webp',
          'image/gif',
          'image/svg+xml',
          'application/pdf',
          'font/woff2',
        ]),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        file: z.strictObject({
          attachmentId: z.string().transform(value => value as AttachmentIdType),
          name: z.string(),
          bytes: z.number().int().nonnegative(),
        }),
      }),
    ),
    createdAt: z.iso.datetime(),
  })
  .superRefine((value, ctx) => {
    if (value.capabilities.length !== (value.profile === 'document' ? 1 : 2))
      ctx.addIssue({ code: 'custom', message: 'Profile and capabilities disagree.' })
    const names = new Set(value.assets.map(asset => asset.name))
    if (value.assets.length === 0 || names.size !== value.assets.length || !names.has(value.entry))
      ctx.addIssue({ code: 'custom', message: 'Manifest entries are empty, duplicated, or absent.' })
  })
const receipt = z.strictObject({
  artifactId,
  revisionId,
  workspaceId,
  sessionId,
  operationId,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  createdAt: z.iso.datetime(),
  chargedBytes: z.number().int().nonnegative(),
  revision: revisionSchema.nullable(),
  committed: z.boolean(),
  abandoned: z.boolean(),
})
/** One atomic ledger; reservations count even when a blob write fails. */
export const ledgerSchema = z.strictObject({ operations: z.array(receipt) })
/** Recoverable pending publication record. */
export type Receipt = z.infer<typeof receipt>
/** Durable whole-ledger value. */
export type Ledger = z.infer<typeof ledgerSchema>
/** Single-write catalogue and operation receipts, versioned independently of Session format. */
export const artifactDomain = defineDomain({
  name: 'artifacts',
  version: 1,
  global: { schema: ledgerSchema, initial: { operations: [] } },
  tables: {},
})
