/** Browser approval composer and correlated-detail props. */
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ApprovalKey } from '../locales.ts'
import type { PendingApproval } from '../pending-approval.ts'

export type { ApprovalDecision, ApprovalPresentationRequest, PendingApproval } from '../pending-approval.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Approval prompt copy. */
    approval: ApprovalKey
  }

  interface SlotMap {
    /** Optional detail for the Tool call correlated with an approval request. */
    'conversation.approval.detail': {
      kind: 'single'
      scope: 'session'
      owner: ApprovalDetailOwnerProps
    }
  }
}

/** Stable identity handed to an optional approval-detail renderer. */
export interface ApprovalDetailOwnerProps {
  /** Tool call correlated with the request. */
  callId: ToolCallId
}

/** Full props of the approval composer takeover. */
export type ApprovalComposerProps =
  PropsRuntime<'conversation.composer'>
  & PropsRenderSlots<'conversation.approval.detail'>
  & { matched: PendingApproval }
  & PropsLocale<'approval'>
