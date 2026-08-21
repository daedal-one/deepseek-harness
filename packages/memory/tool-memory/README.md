# `@deepseek-ai/dsh-tool-memory`

Ordinary memory Consumer exposing query, get, propose, challenge, and checkpoint tools. Project scope is derived from the session workspace; models cannot choose another project path. Every global mutation requests approval at execution time and proceeds only after `allowed-once`.

## Model Experience

### System prompt

#### What the model sees

The model sees the fixed policy below.

##### Memory policy

```markdown
Use memory_query before relying on prior facts. Project memory is isolated by the current session workspace. Global proposals and other global writes always require one-time human approval. Proposals are unreviewed until a trusted reviewer accepts them; preserve evidence and link contradictions.
```

#### Token effect

Fixed guidance cost while the Consumer is mounted.

#### KV Cache effect

Prefix-stable while the policy text and plugin lifecycle are unchanged.

### Tool schemas and results

#### What the model sees

The model sees the generated [`memory_query`, `memory_get`, `memory_propose`, `memory_challenge`, and `memory_checkpoint` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-memory). Read results contain bounded records; mutations return the complete changed record or error.

#### Token effect

Fixed schema cost plus data-dependent retained call arguments and results. Provider search limits cap query results.

#### KV Cache effect

Schemas are prefix-stable while visibility is unchanged. Calls and results are append-only and do not invalidate an already reusable prefix.

## Known Limitations and Deferred Work

- Evidence entered through ordinary tools is a reference string. Automated extraction can persist richer session evidence directly through the Service Definition.
