/** Shared Chat Definitions for compiled conversation benchmarks. */
// These Client-only fold modules have no plain-Node package export and are compiled into this worker.
import { inspectRequestPrompt } from '../../packages/client/ui-conversation/src/client/contract/request-inspection.ts'
import type {
  ConversationNodeDefinition,
  ConversationViewDefinition,
} from '../../packages/client/ui-conversation/src/client/contract/conversation.ts'
import { assistantDefinition } from '../../packages/client/ui-chat/src/client/conversation-nodes/assistant.ts'
import { chatViewDefinition } from '../../packages/client/ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts'
import { commandDefinition } from '../../packages/client/ui-chat/src/client/conversation-nodes/command.ts'
import { compactionDefinition } from '../../packages/client/ui-chat/src/client/conversation-nodes/compaction.ts'
import { unknownFallbackDefinition } from '../../packages/client/ui-chat/src/client/conversation-nodes/fallback.ts'
import { nextStepInboxDefinition } from '../../packages/client/ui-chat/src/client/conversation-nodes/inbox.ts'
import { messageDefinition } from '../../packages/client/ui-chat/src/client/conversation-nodes/message.ts'
import { requestPromptDefinition } from '../../packages/client/ui-chat/src/client/conversation-nodes/request-prompt.ts'
import { retryDefinition } from '../../packages/client/ui-chat/src/client/conversation-nodes/retry.ts'
import { toolDefinition } from '../../packages/client/ui-chat/src/client/conversation-nodes/tool.ts'
import { turnErrorDefinition } from '../../packages/client/ui-chat/src/client/conversation-nodes/turn-error.ts'
import { turnMaxTokensDefinition } from '../../packages/client/ui-chat/src/client/conversation-nodes/turn-max-tokens.ts'
import { turnProcessDefinition } from '../../packages/client/ui-chat/src/client/conversation-nodes/turn-process.ts'
import { turnTailDefinition } from '../../packages/client/ui-chat/src/client/conversation-nodes/turn-tail.ts'
/** The production Chat event Definitions used by both measured workloads. */
export class BenchEventDefinitions {
  readonly definitions: readonly ConversationNodeDefinition[] = [
    nextStepInboxDefinition,
    messageDefinition,
    requestPromptDefinition(inspectRequestPrompt),
    assistantDefinition,
    turnProcessDefinition,
    toolDefinition,
    commandDefinition,
    compactionDefinition,
    retryDefinition,
    turnErrorDefinition,
    turnMaxTokensDefinition,
    turnTailDefinition,
  ]

  /** @returns the production Chat definitions in registration order. */
  entries(): readonly ConversationNodeDefinition[] {
    return this.definitions
  }

  /** @returns the production unknown-event fallback. */
  fallbackEntry(): ConversationNodeDefinition {
    return unknownFallbackDefinition
  }
}

/** The production Chat view builder used by both measured workloads. */
export class BenchViewDefinitions {
  /** @returns the production Chat view definition. */
  entries(): readonly ConversationViewDefinition[] {
    return [chatViewDefinition]
  }
}
