# `@deepseek-ai/dsh-tool-memory-reviewer`

Privileged memory Consumer exposing pending-item discovery, review, supersession, and deletion only inside subagent children carrying its config-selected principal. Root and ordinary children receive no reviewer prompt or tool schemas. Every execution also folds the durable subagent descriptor and requires the same principal; no model argument, persona, or role string can claim reviewer authority. Global mutations additionally require an `allowed-once` approval.

## Model Experience

### Principal-scoped prompt and tools

#### What the model sees

Only a matching principal child sees the reviewer policy and generated [`memory_list_pending`, `memory_review`, `memory_supersede`, and `memory_delete` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-memory-reviewer). Root and ordinary children see none of them. Pending reads return bounded proposed and challenged records; mutations return complete changed records or errors.

#### Token effect

Fixed prompt and schema cost only inside matching children, plus data-dependent retained call arguments and results.

#### KV Cache effect

Prefix-stable while the principal capability remains installed. Adding or revoking it invalidates reuse from the first changed prompt or schema token; calls and results are append-only.

## Known Limitations and Deferred Work

- Only session-backed subagents with a matching durable principal can use the tools. Other provider families need an equally durable process-owned principal before they can act as reviewers.
