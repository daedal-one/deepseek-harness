---
description: "Immutable Workspace artifact identity, durable publication and independent presentation protocol."
---

# Workspace artifacts

## Summary

Artifacts preserve generated outputs as immutable revisions owned by one Workspace. The catalogue remains available across Session inactivity and execution-environment removal. The artifact runtime receives only the selected revision’s published assets and transient presentation input. Trusted Harness controls own editing, restoration, export and agent requests.

## Table of Contents

- [Publication and recovery](#publication-and-recovery)
- [Presentation authority](#presentation-authority)
- [Types](#types)
- [Cordis API](#cordis-api)
- [Further Exploration](#further-exploration)

## Publication and recovery

The artifact service derives creation ownership from the exact live initiating Session’s durable Workspace membership. Publication reserves bounded storage, captures and verifies explicit bytes, persists the immutable receipt, appends the Session publication event and awaits its persistence checkpoint before committing the catalogue head. Expected-head mutation rejects concurrent edits. An exact Session-scoped operation identity returns the original revision after a retry; different input with that identity rejects.

HTML, SVG, CSS, JavaScript modules and Markdown images must declare canonical references to explicitly supplied assets. Publication parses those declarations without reading paths or fetching URLs and refuses missing or remote dependencies, computed imports, nested browsing contexts, import maps and opaque CSS. Runtime policy also denies computed requests that static declarations cannot enumerate. Plain text and JSON remain inert data; PDF rendering does not follow external actions.

Pending reservations are excluded from committed catalogues. Recovery commits only an exact matching durable Session publication; an explicit reconciliation with no publication safely abandons the reservation. Abandoned reservations remain charged against storage admission. Startup refuses duplicate identities, inconsistent chains and committed receipts without their durable publication evidence. Reads verify exact asset length and digest before returning bytes.

## Presentation authority

The document profile disables artifact-authored scripts. Interactive-local enables computation over the exact published asset set and transient input. Both profiles exclude networking, Session files, credentials, application storage, Harness services and other artifacts. The runtime provider enforces process, memory, CPU, lifetime and output limits independently of Session execution. An unavailable provider leaves source, history and export usable.

The presentation channel carries a bounded PNG and inert text, plus a closed set of pointer, key and text inputs. Invocations bind an unpredictable identity to the exact immutable revision. Replacement, stream cancellation, Workspace deletion and plugin disposal revoke execution. A removal failure quarantines the provider and retains cleanup ownership.

## Types

### ArtifactId

```ts type-equiv
/** Host-assigned artifact identity; never a storage path or bearer credential. */
type ArtifactId = Branded<'ArtifactId'>
```

### ArtifactRevisionId

```ts type-equiv
/** Host-assigned immutable revision identity. */
type ArtifactRevisionId = Branded<'ArtifactRevisionId'>
```

### ArtifactOperationId

```ts type-equiv
/** Caller retry identity scoped to its creating Session. */
type ArtifactOperationId = Branded<'ArtifactOperationId'>
```

### ArtifactProfile

```ts type-equiv
/** Closed execution policy; unknown policies are refused. */
type ArtifactProfile = 'document' | 'interactive-local'
```

### ArtifactAsset

```ts type-equiv
/** One immutable, explicitly published asset. */
interface ArtifactAsset {
  readonly name: string
  readonly mediaType: string
  readonly sha256: string
  readonly file: FileAttachmentRef
}
```

### ArtifactRevision

```ts type-equiv
/** Complete immutable revision and its durable provenance. */
interface ArtifactRevision {
  readonly artifactId: ArtifactId
  readonly revisionId: ArtifactRevisionId
  readonly workspaceId: WorkspaceId
  readonly sessionId: SessionId
  readonly operationId: ArtifactOperationId
  readonly parent: ArtifactRevisionId | null
  readonly restoredFrom: ArtifactRevisionId | null
  readonly title: string
  readonly entry: string
  readonly profile: ArtifactProfile
  readonly capabilities: readonly ['published-assets', 'transient-input'] | readonly ['published-assets']
  readonly assets: readonly ArtifactAsset[]
  readonly createdAt: string
}
```

### ArtifactAssetInput

```ts type-equiv
/** Inline asset input; publication never discovers files or follows URLs. */
interface ArtifactAssetInput {
  readonly name: string
  readonly mediaType: string
  readonly data: string
}
```

### ArtifactPublish

```ts type-equiv
/** A complete proposed revision, with explicit optimistic concurrency. */
interface ArtifactPublish {
  readonly operationId: ArtifactOperationId
  readonly artifactId: ArtifactId | null
  readonly expectedHead: ArtifactRevisionId | null
  readonly title: string
  readonly entry: string
  readonly profile: ArtifactProfile
  readonly assets: readonly ArtifactAssetInput[]
}
```

### ArtifactSummary

```ts type-equiv
/** New head plus the number of retained immutable revisions. */
interface ArtifactSummary {
  readonly head: ArtifactRevision
  readonly revisionCount: number
}
```

### ArtifactPage

```ts type-equiv
/** Bounded deterministic catalogue page; cursor belongs to this Workspace. */
interface ArtifactPage {
  readonly items: readonly ArtifactSummary[]
  readonly next: ArtifactId | null
}
```

### ArtifactPending

```ts type-equiv
/** Interrupted operation retained until explicit reconciliation. */
interface ArtifactPending {
  readonly artifactId: ArtifactId
  readonly revisionId: ArtifactRevisionId
  readonly sessionId: SessionId
  readonly operationId: ArtifactOperationId
  readonly createdAt: string
}
```

### ArtifactContent

```ts type-equiv
/** Verified complete bytes of one explicitly selected revision asset. */
interface ArtifactContent {
  readonly revision: ArtifactRevision
  readonly asset: ArtifactAsset
  readonly data: string
}
```

### ArtifactInvocationId

```ts type-equiv
/** Unpredictable invocation identifier bound to one immutable revision. */
type ArtifactInvocationId = Branded<'ArtifactInvocationId'>
```

### ArtifactRuntimeInput

```ts type-equiv
/** Complete verified assets supplied only by the artifact owner. */
interface ArtifactRuntimeInput {
  readonly revision: ArtifactRevision
  readonly assets: readonly ArtifactContent[]
}
```

### ArtifactRuntimeInteraction

```ts type-equiv
/** Closed transient presentation inputs; there is no tool, filesystem, or network message. */
type ArtifactRuntimeInteraction =
  | { readonly type: 'pointer'; readonly x: number; readonly y: number }
  | { readonly type: 'key'; readonly key: ArtifactRuntimeKey }
  | { readonly type: 'text'; readonly text: string }
```

### ArtifactFrame

```ts type-equiv
/** Bounded rendered raster and inert accessible text. */
interface ArtifactFrame {
  readonly invocationId: ArtifactInvocationId
  readonly revisionId: ArtifactRevision['revisionId']
  readonly png: string
  readonly text: string
  readonly width: number
  readonly height: number
}
```

### ArtifactInvocation

```ts type-equiv
/** Single independently sandboxed lifetime. */
interface ArtifactInvocation {
  readonly id: ArtifactInvocationId
  /** Settles only after runtime removal; rejects if resource revocation failed. */
  readonly ended: Promise<void>
  /** @param input - closed transient input. @returns next bounded presentation frame. */
  interact(input: ArtifactRuntimeInteraction | null): Promise<ArtifactFrame>
  /** @returns completion after runtime removal and queued work settlement. */
  close(): Promise<void>
}
```

### ArtifactPolicy

```ts type-equiv
/** Trusted artifact control admission policy. @module */
interface ArtifactPolicy {
  readonly previewAvailable: boolean
  /** Maximum retained viewer bytes, including decoded text and preview pixels. */
  readonly maxRetainedBytes: number
  readonly maxEditBytes: number
  readonly maxSelectionBytes: number
}
```

### ArtifactRuntimeKey

```ts type-equiv
/** Allowed nonprivileged presentation keys; system shortcuts are excluded. */
type ArtifactRuntimeKey =
  | 'Tab'
  | 'Enter'
  | 'Space'
  | 'Backspace'
  | 'Delete'
  | 'Escape'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'Home'
  | 'End'
```

## Cordis API

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxartifactruntime--artifactruntime-abstract-seam"></a>

### `ctx.artifactRuntime` — `ArtifactRuntime` (abstract seam)

Providers must enforce network denial and resource bounds independently of Session execution.

```ts cordis-catalog
/**
 * Allocate one independently confined runtime lifetime.
 * @param input - one complete immutable revision without Session authority.
 * @param signal - invocation cancellation.
 * @returns independently owned sandbox invocation.
 */
abstract open(input: ArtifactRuntimeInput, signal: AbortSignal): Promise<ArtifactInvocation>
```

Source: [`packages/artifact/artifact-runtime/src/index.ts`](../../packages/artifact/artifact-runtime/src/index.ts)

<a id="ctxartifacts--artifacts-abstract-seam"></a>

### `ctx.artifacts` — `Artifacts` (abstract seam)

Artifact ownership is checked by the provider on every operation.

```ts cordis-catalog
/**
 * List recoverable publication reservations for the selected Workspace.
 * @param workspaceId - selected durable Workspace.
 * @returns bounded interrupted operations.
 */
abstract pending(workspaceId: WorkspaceId): Promise<readonly ArtifactPending[]>

/**
 * Resolve an interrupted operation against durable Session evidence.
 * @param workspaceId - selected durable Workspace.
 * @param revisionId - interrupted operation's assigned revision.
 * @returns committed revision, or null when no publication event exists and the reservation was safely abandoned.
 */
abstract reconcile( workspaceId: WorkspaceId, revisionId: ArtifactRevisionId, ): Promise<ArtifactRevision | null>

/**
 * Persist and checkpoint one complete immutable revision.
 * @param session - exact live creating Session.
 * @param request - complete revision and retry identity.
 * @returns durable committed revision.
 */
abstract publish(session: Session, request: ArtifactPublish): Promise<ArtifactRevision>

/**
 * Read committed artifact heads without activating creating Sessions.
 * @param workspaceId - selected durable Workspace.
 * @param after - exclusive artifact cursor.
 * @returns bounded current-head catalogue.
 */
abstract list(workspaceId: WorkspaceId, after: ArtifactId | null): Promise<ArtifactPage>

/**
 * Read an artifact’s immutable revision history.
 * @param workspaceId - selected durable Workspace.
 * @param artifactId - artifact owned by it.
 * @param before - exclusive revision cursor.
 * @returns bounded newest-first history.
 */
abstract history( workspaceId: WorkspaceId, artifactId: ArtifactId, before: ArtifactRevisionId | null, ): Promise<readonly ArtifactRevision[]>

/**
 * Verify and return bytes belonging to an exact Workspace revision.
 * @param workspaceId - selected durable Workspace.
 * @param artifactId - owned artifact.
 * @param revisionId - exact retained revision.
 * @param name - exact manifest asset name.
 * @param signal - optional read cancellation.
 * @returns verified immutable content.
 */
abstract read( workspaceId: WorkspaceId, artifactId: ArtifactId, revisionId: ArtifactRevisionId, name: string, signal?: AbortSignal, ): Promise<ArtifactContent>

/**
 * Publish a retained revision as a new head with optimistic concurrency.
 * @param session - exact live Session in the artifact Workspace.
 * @param artifactId - owned artifact.
 * @param revisionId - immutable restore source.
 * @param expectedHead - head observed by caller.
 * @param operationId - scoped retry identity.
 * @returns a new revision preserving history.
 */
abstract restore( session: Session, artifactId: ArtifactId, revisionId: ArtifactRevisionId, expectedHead: ArtifactRevisionId, operationId: ArtifactOperationId, ): Promise<ArtifactRevision>
```

Types: [Session](session.md) · [WorkspaceId](workspace.md)

Source: [`packages/artifact/artifact/src/index.ts`](../../packages/artifact/artifact/src/index.ts)

<a id="ctxartifactscontroller--artifactscontroller"></a>

### `ctx.artifactsController` — `ArtifactsController`

Every Remote is behind the authenticated gateway; Workspace ownership is checked in the executor.

```ts cordis-catalog
/**
 * Read execution availability and trusted editing bounds.
 * @returns capability availability and authoritative trusted-text limits.
 */
@Remote policy(): ArtifactPolicy

/**
 * Publish an exact-head replacement for one retained text asset.
 * @param session - authorized live editing Session.
 * @param workspaceId - selected Workspace.
 * @param artifactId - owned artifact.
 * @param expectedHead - exact observed revision.
 * @param name - retained text asset.
 * @param content - complete replacement text.
 * @param operationId - retry identity.
 * @returns a new immutable revision or conflict.
 */
@Remote async edit( session: Session, workspaceId: WorkspaceId, artifactId: ArtifactId, expectedHead: ArtifactRevisionId, name: string, content: string, operationId: ArtifactOperationId, ): Promise<ArtifactRevision>

/**
 * Stream coalesced invalidations after durable catalogue changes.
 * @param workspaceId - explicitly selected Workspace.
 * @param signal - subscription cancellation.
 * @returns bounded invalidations; consumers reread an authorized catalogue page.
 */
@Remote({ mode: 'stream' }) async *watch(workspaceId: WorkspaceId, signal: AbortSignal): AsyncIterable<boolean>

/**
 * List recoverable publication reservations for the selected Workspace.
 * @param workspaceId - selected Workspace.
 * @returns bounded interrupted saves.
 */
@Remote pending(workspaceId: WorkspaceId): Promise<readonly ArtifactPending[]>

/**
 * Resolve an interrupted operation against durable Session evidence.
 * @param workspaceId - selected Workspace.
 * @param revisionId - exact interrupted operation.
 * @returns recovered revision, or null after safe abandonment.
 */
@Remote reconcile(workspaceId: WorkspaceId, revisionId: ArtifactRevisionId): Promise<ArtifactRevision | null>

/**
 * Read committed artifact heads without activating creating Sessions.
 * @param workspaceId - explicitly selected Workspace.
 * @param after - exclusive cursor or first page.
 * @returns bounded committed heads.
 */
@Remote list(workspaceId: WorkspaceId, after: ArtifactId | null): Promise<ArtifactPage>

/**
 * Read an artifact’s immutable revision history.
 * @param workspaceId - explicitly selected Workspace.
 * @param artifactId - owned artifact.
 * @param before - exclusive revision cursor.
 * @returns bounded immutable history.
 */
@Remote history( workspaceId: WorkspaceId, artifactId: ArtifactId, before: ArtifactRevisionId | null, ): Promise<readonly ArtifactRevision[]>

/**
 * Verify and return bytes belonging to an exact Workspace revision.
 * @param workspaceId - explicitly selected Workspace.
 * @param artifactId - owned artifact.
 * @param revisionId - exact revision.
 * @param name - manifest asset name.
 * @param signal - read cancellation.
 * @returns verified complete immutable bytes.
 */
@Remote read( workspaceId: WorkspaceId, artifactId: ArtifactId, revisionId: ArtifactRevisionId, name: string, signal: AbortSignal, ): Promise<ArtifactContent>

/**
 * Persist and checkpoint one complete immutable revision.
 * @param session - authorized live editing Session resolved by the gateway.
 * @param request - complete immutable replacement.
 * @returns durable new revision or conflict.
 */
@Remote publish(session: Session, request: ArtifactPublish): Promise<ArtifactRevision>

/**
 * Publish a retained revision as a new head with optimistic concurrency.
 * @param session - authorized live editing Session resolved by the gateway.
 * @param artifactId - owned artifact.
 * @param revisionId - restore source.
 * @param expectedHead - observed head.
 * @param operationId - retry identity.
 * @returns new immutable revision.
 */
@Remote restore( session: Session, artifactId: ArtifactId, revisionId: ArtifactRevisionId, expectedHead: ArtifactRevisionId, operationId: ArtifactOperationId, ): Promise<ArtifactRevision>

/**
 * Lease a bounded rendering of one immutable revision.
 * @param workspaceId - selected Workspace.
 * @param artifactId - owned artifact.
 * @param revisionId - immutable revision.
 * @param entry - manifest entry asset.
 * @param signal - preview-stream revocation.
 * @returns initial rendered frame followed by lease lifetime; inputs use the exact returned invocation identity.
 */
@Remote({ mode: 'stream' }) async *preview( workspaceId: WorkspaceId, artifactId: ArtifactId, revisionId: ArtifactRevisionId, entry: string, signal: AbortSignal, ): AsyncIterable<ArtifactFrame>

/**
 * Forward a closed transient input to the exact preview lease.
 * @param workspaceId - selected Workspace.
 * @param artifactId - owned artifact.
 * @param revisionId - pinned revision.
 * @param invocationId - unpredictable identity returned by the preview stream.
 * @param input - nonprivileged presentation input.
 * @returns the resulting bounded rendered frame.
 */
@Remote async interact( workspaceId: WorkspaceId, artifactId: ArtifactId, revisionId: ArtifactRevisionId, invocationId: ArtifactInvocationId, input: ArtifactRuntimeInteraction, ): Promise<ArtifactFrame>
```

Types: [Session](session.md) · [WorkspaceId](workspace.md)

Source: [`packages/api/artifacts/src/index.ts`](../../packages/api/artifacts/src/index.ts)

<a id="artifact-events"></a>

### `artifact/*` events

<a id="artifactchanged--emit"></a>

#### `artifact/changed` — emit

An artifact catalogue changes after its durable head commit.

```ts cordis-catalog
/**
 * An artifact catalogue changes after its durable head commit.
 * @param workspaceId - exact Workspace whose catalogue changed.
 * @mode emit
 */
'artifact/changed'(workspaceId: WorkspaceId): void
```

Types: [WorkspaceId](workspace.md)

Source: [`packages/artifact/artifact/src/index.ts`](../../packages/artifact/artifact/src/index.ts)
<!-- END GENERATED cordis-surface -->

## Further Exploration

- [Artifact packages](../../packages/artifact/README.md)
- [Using artifacts](../user/artifacts.md)
- [Architecture](../architecture.md)

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
