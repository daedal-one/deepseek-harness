/** Approval dictionary key union. */
export type ApprovalKey = keyof typeof en

/** English copy for this feature. */
export const en = {
  waiting: 'Waiting for approval',
  'detail.aria': 'Approval details',
  escalation: 'Tool {toolName} requests privileged execution',
  reject: 'Reject',
  allowOnce: 'Allow once',
} satisfies Record<string, string>
