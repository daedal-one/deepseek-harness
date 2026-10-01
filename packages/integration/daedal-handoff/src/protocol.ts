/** Private, versioned host-handoff request validation. @module */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Opaque operator-owned catalog identifier. */
export type HandoffTargetId = Branded<'HandoffTargetId'>

/** Fixed authenticated endpoint shared by the two explicitly configured profiles. */
export const HANDOFF_PATH = '/daedal-handoff/v2'
/** Presets admitted by the handoff executor and receiver. */
export const daedalPreset = z.enum(['daedal', 'daedal-openai'])
/** Operator-owned profile and resolved permissions displayed before confirmation. */
export const targetSchema = z.object({
  id: z.string().min(1).transform(brandString<HandoffTargetId>), name: z.string().min(1), cwd: z.string().min(1),
  agentPreset: z.string().min(1), permissionPreset: z.string().min(1),
  environment: z.literal('host'),
  sandbox: z.enum(['read-only', 'workspace-write', 'danger-full-access']),
  approval: z.enum(['ask', 'never']),
}).strict()
/** Receiver identity shared by every configured target. */
const hostSchema = z.object({
  name: z.string().min(1),
  url: z.url().refine((value) => {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      && url.pathname === '/' && !url.search && !url.hash
  }).optional(),
}).strict()
/** Authenticated target discovery; no caller-supplied profile composition is accepted. */
export const catalogSchema = hostSchema.extend({ targets: z.array(targetSchema).min(1) }).strict()
/** Exact host and target settings approved by the user. */
export const destinationSchema = hostSchema.extend({ target: targetSchema }).strict()
/** Complete task transferred after human confirmation. */
export const taskSchema = z.object({ title: z.string().trim().min(1), task: z.string().trim().min(1) }).strict()
/** Wire request; the receiver bounds the complete UTF-8 body before parsing. */
export const requestSchema = z.object({
  sourceSessionId: z.string().min(1).transform(SessionId),
  callId: z.string().min(1).transform(ToolCallId),
  destination: destinationSchema,
  ...taskSchema.shape,
}).strict()
/** Receiver acknowledgement, without credentials or internal errors. */
export const receiptSchema = z.object({ sessionId: z.string().min(1).transform(SessionId), accepted: z.literal(true) }).strict()

/**
 * Derive the same identity for a repeated delivery of the exact approved request.
 * @param request - validated task and caller identity.
 * @returns destination Session id; changing any approved field changes the identity.
 */
export function handoffSessionId(request: z.input<typeof requestSchema>): SessionId {
  return SessionId(`handoff-${createHash('sha256').update(JSON.stringify(requestSchema.parse(request))).digest('hex')}`)
}
