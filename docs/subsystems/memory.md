# Durable reviewed memory

English | [中文](memory.zh.md)

The memory capability stores evidence-backed statements across sessions without treating extracted model output as accepted fact. The [durable reviewed-memory decision](../../.agents/notes/implemented/feature/2026-08-16-durable-reviewed-memory.md) owns scope isolation, review authority, approval, and extraction timing; this page records the provider-neutral data and service API from [`packages/memory/memory/src/types.ts`](../../packages/memory/memory/src/types.ts).

## Identity, scope, and provenance

Every existing-record mutation carries a branded id, explicit scope, and compare-and-set revision. Project scope is one canonical absolute workspace path; global scope is separate and its tool mutations require live approval.

```ts type-equiv
/** Stable memory identifier shared by providers and Consumers. */
type MemoryId = Branded<'MemoryId'>
```

```ts type-equiv
/** An explicit isolation domain for one memory operation. */
type MemoryScope =
  | { readonly kind: 'project'; readonly project: string }
  | { readonly kind: 'global' }
```

```ts type-equiv
/** Evidence supporting or challenging a durable memory. */
interface MemoryEvidence {
  readonly kind: 'session' | 'file' | 'url' | 'user' | 'agent' | 'tool'
  readonly ref: string
  readonly excerpt?: string
}
```

```ts type-equiv
/** Confidence and provenance assigned to one memory revision. */
interface MemoryTrust {
  readonly score: number
  readonly source: 'extracted' | 'agent' | 'user' | 'reviewer'
}
```

```ts type-equiv
/** Optional interval during which the statement is expected to hold. */
interface MemoryValidity { readonly validFrom?: number; readonly validUntil?: number }
```

## Records and lifecycle

Extracted and ordinary statements begin as proposals. Review can activate or reject them; a challenge preserves contrary evidence; supersession atomically creates an accepted replacement and retires the prior revision.

```ts type-equiv
/** Review lifecycle of a durable memory. */
type MemoryStatus = 'proposed' | 'active' | 'challenged' | 'rejected' | 'superseded'
```

```ts type-equiv
/** Complete durable memory record. */
interface MemoryRecord {
  readonly id: MemoryId
  readonly revision: number
  readonly scope: MemoryScope
  readonly statement: string
  readonly status: MemoryStatus
  readonly evidence: readonly MemoryEvidence[]
  readonly trust: MemoryTrust
  readonly validity: MemoryValidity
  readonly contradicts: readonly MemoryId[]
  readonly challenge?: { readonly reason: string; readonly evidence: readonly MemoryEvidence[] }
  readonly supersededBy?: MemoryId
  readonly createdAt: number
  readonly updatedAt: number
  readonly lastAccessedAt: number
  readonly accessCount: number
}
```

```ts type-equiv
/** Compare-and-set reference used for review mutations. */
interface MemoryRef { readonly scope: MemoryScope; readonly id: MemoryId; readonly revision: number }
```

## Requests and results

Queries are scope-local and provider-bounded. Contradiction and replacement references cannot cross scope. Checkpoints revision the accessed records, so every metadata mutation participates in the same compare-and-set discipline.

```ts type-equiv
/** New unreviewed statement. */
interface MemoryProposal {
  readonly scope: MemoryScope
  readonly statement: string
  readonly evidence: readonly MemoryEvidence[]
  readonly trust: MemoryTrust
  readonly validity?: MemoryValidity
  readonly contradicts?: readonly MemoryId[]
}
```

```ts type-equiv
/** Scope-bounded full-text lookup. */
interface MemoryQuery {
  readonly scope: MemoryScope
  readonly text: string
  readonly statuses?: readonly MemoryStatus[]
  readonly limit?: number
  readonly at?: number
}
```

```ts type-equiv
/** One query response, including provider-side truncation. */
interface MemoryQueryResult { readonly memories: readonly MemoryRecord[]; readonly truncated: boolean }
```

```ts type-equiv
/** Challenge one exact memory revision. */
interface MemoryChallenge { readonly ref: MemoryRef; readonly reason: string; readonly evidence?: readonly MemoryEvidence[] }
```

```ts type-equiv
/** Reviewer decision over one exact revision. */
interface MemoryReview { readonly ref: MemoryRef; readonly decision: 'accept' | 'reject'; readonly trust?: MemoryTrust }
```

```ts type-equiv
/** Atomically replace one memory with a reviewed successor. */
interface MemorySupersession { readonly ref: MemoryRef; readonly replacement: MemoryProposal }
```

```ts type-equiv
/** Record access to exact scope-bound memory revisions. */
interface MemoryCheckpoint { readonly refs: readonly MemoryRef[] }
```

## Provider API and failures

One runtime selects one registered provider. Providers reject unavailable, ambiguous, stale, cross-scope, and invalid lifecycle operations with `MemoryError`; callers route on its stable `code` and must not infer state from message text.

```ts type-equiv
/** Storage implementation behind the memory Service Definition. */
interface MemoryProvider {
  readonly id: string
  query(request: MemoryQuery): Promise<MemoryQueryResult>
  get(scope: MemoryScope, id: MemoryId): Promise<MemoryRecord | undefined>
  propose(request: MemoryProposal): Promise<MemoryRecord>
  challenge(request: MemoryChallenge): Promise<MemoryRecord>
  review(request: MemoryReview): Promise<MemoryRecord>
  supersede(request: MemorySupersession): Promise<{ readonly previous: MemoryRecord; readonly replacement: MemoryRecord }>
  checkpoint(request: MemoryCheckpoint): Promise<readonly MemoryRecord[]>
  delete(ref: MemoryRef): Promise<boolean>
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmemory--memoryruntime"></a>

### `ctx.memory` — `MemoryRuntime`

Provider-selecting durable-memory runtime.

```ts cordis-catalog
/**
 * Register one storage provider for the calling fiber.
 * @param provider - storage implementation and stable provider id.
 * @returns the effect-owned registration disposer.
 */
registerProvider(provider: MemoryProvider): () => void

/**
 * Query one explicit memory scope.
 * @param request - scoped text, statuses, temporal point, and limit.
 * @returns bounded matching records.
 */
query(request: MemoryQuery): Promise<MemoryQueryResult>

/**
 * Read one id only inside its explicit scope.
 * @param scope - exact project or global scope.
 * @param id - branded memory identifier.
 * @returns the record, or undefined when absent from that scope.
 */
get(scope: MemoryScope, id: MemoryId): Promise<MemoryRecord | undefined>

/**
 * Persist an unreviewed proposal.
 * @param request - scoped statement, evidence, trust, validity, and contradictions.
 * @returns the created proposal record.
 */
propose(request: MemoryProposal): Promise<MemoryRecord>

/**
 * Challenge one exact scope-bound revision.
 * @param request - compare-and-set ref, reason, and contrary evidence.
 * @returns the challenged record revision.
 */
challenge(request: MemoryChallenge): Promise<MemoryRecord>

/**
 * Accept or reject one exact scope-bound revision.
 * @param request - compare-and-set ref and reviewer decision.
 * @returns the reviewed record revision.
 */
review(request: MemoryReview): Promise<MemoryRecord>

/**
 * Atomically supersede one exact scope-bound revision.
 * @param request - prior ref and same-scope replacement.
 * @returns the previous and replacement records after commit.
 */
supersede( request: MemorySupersession, ): Promise<{ readonly previous: MemoryRecord; readonly replacement: MemoryRecord }>

/**
 * Checkpoint use of exact scope-bound memory revisions.
 * @param request - unique compare-and-set refs.
 * @returns the revisioned records with updated access facts.
 */
checkpoint(request: MemoryCheckpoint): Promise<readonly MemoryRecord[]>

/**
 * Delete one exact scope-bound revision.
 * @param ref - exact scope, id, and revision.
 * @returns whether the record was deleted.
 */
delete(ref: MemoryRef): Promise<boolean>
```

Source: [`packages/memory/memory/src/index.ts:11`](../../packages/memory/memory/src/index.ts)
<!-- END GENERATED cordis-surface -->
