/** Keyless snapshot answerer that grants the exact assembled approval request once. */

import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'

export const name = 'snapshot-approval-allow-once'
export const inject = ['approval']

/** Register the deterministic snapshot-only approval answerer. */
export function apply(ctx: Context): void {
  ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
}
