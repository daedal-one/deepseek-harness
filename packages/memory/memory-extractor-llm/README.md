# `@deepseek-ai/dsh-memory-extractor-llm`

English | [中文](README.zh.md)

Asynchronous project-memory extraction after a completed `turn/end` has reached session persistence. The bounded queue records the exact auxiliary request before dispatch, flushes it, then records the exact assembled response and proposal ids. Timeout, cancellation, provider failure, malformed output, and saturation settle independently without failing the parent turn. Disposal aborts and awaits active calls.

## Model Experience

### Auxiliary extraction request

#### What the model sees

The configured auxiliary model receives one fixed extraction instruction and a JSON array of the completed turn's durable events. It returns strict JSON proposals and receives no tools.

#### Token effect

One independent bounded request may follow each completed turn. `maxInputBytes`, `maxOutputTokens`, and `maxProposals` cap the complete request and accepted result; extracted statements do not enter the main agent context.

#### KV Cache effect

Independent from the main agent request. The fixed system instruction is prefix-stable; completed-turn event JSON changes per request.

## Known Limitations and Deferred Work

- Automatic extraction creates project proposals only. Promoting extracted facts to global memory always remains an explicit, approved reviewer operation.
