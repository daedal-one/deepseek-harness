import type {
  ConversationEventRegistry, ConversationViewRegistry, RequestPromptInspector, SystemPromptInspector,
} from '@deepseek-ai/dsh-client-ui-conversation/client/portable'
import { assistantDefinition } from './assistant.ts'
import { chatViewDefinition } from './chat-snapshot-builder.ts'
import { commandDefinition } from './command.ts'
import { compactionDefinition } from './compaction.ts'
import { unknownFallbackDefinition } from './fallback.ts'
import { nextStepInboxDefinition } from './inbox.ts'
import { messageDefinition } from './message.ts'
import { requestPromptDefinition, systemMessageDefinition } from './request-prompt.ts'
import { retryDefinition } from './retry.ts'
import { toolDefinition } from './tool.ts'
import { turnErrorDefinition } from './turn-error.ts'
import { turnMaxTokensDefinition } from './turn-max-tokens.ts'
import { turnProcessDefinition } from './turn-process.ts'
import { turnTailDefinition } from './turn-tail.ts'

/** Effect-owned registration and pure prompt inspection required by the Chat target. */
export interface ChatConversationRegistration {
  readonly events: Pick<ConversationEventRegistry, 'register' | 'registerFallback'>
  readonly views: Pick<ConversationViewRegistry, 'register'>
  readonly inspectSystemPrompt: SystemPromptInspector
  readonly inspectRequestPrompt: RequestPromptInspector
}

/**
 * Install the Chat business Definitions and snapshot builder for the registry owner's lifetime.
 * Duplicate contribution names fail through the registry; the caller owns registration-scope disposal.
 * @param conversation - scoped registries and the shared prompt inspectors.
 */
export function registerConversationNodes(conversation: ChatConversationRegistration): void {
  const definitions = [
    nextStepInboxDefinition,
    messageDefinition,
    systemMessageDefinition((previous, event) => conversation.inspectSystemPrompt(previous, event)),
    requestPromptDefinition((previous, event, system) => conversation.inspectRequestPrompt(previous, event, system)),
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
  for (const definition of definitions) conversation.events.register(definition)
  conversation.events.registerFallback(unknownFallbackDefinition)
  conversation.views.register(chatViewDefinition)
}
