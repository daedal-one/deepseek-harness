---
description: "Keep generated outputs and every retained revision after a conversation stops. Read exact saved bytes, compare history, restore a revision, and reconcile interrupted saves. Configured storage and revision limits stop new admission while preserving retained content."
kind: "package-reference"
---

# @deepseek-ai/dsh-artifact-durable

## Summary

Keep generated outputs and every retained revision after a conversation stops. Read exact saved bytes, compare history, restore a revision, and reconcile interrupted saves. Configured storage and revision limits stop new admission while preserving retained content.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this provider over storageDomain, attachments, sessions, sessionPersistence and workspaceRegistry. The [artifacts bundle](../../bundle/artifacts/README.md) supplies a complete bounded configuration; every Config field is required. Publication requires exactly one Workspace attachment for its live creating Session. Supply every asset explicitly; parsed HTML/SVG, stylesheet, module and Markdown-image references must name those published assets. Remote dependencies, computed imports, iframe/object/embed content, import maps and opaque CSS are refused before capture. Computed runtime requests remain subject to the independent renderer policy.
### Configuration

All listed fields are required deployment choices; the validated [Config declaration](src/index.ts) defines accepted ranges.

| Field | Default | Meaning |
|---|---|---|
| `maxQueuedOperations` | required | Maximum accepted mutations, including the active operation. |
| `maxConcurrentReads` | required | Maximum in-flight verified asset reads. |
| `readTimeoutMs` | required | Verified asset read deadline in milliseconds. |
| `maxResponseBytes` | required | Maximum complete catalogue, revision or asset response bytes. |
| `maxRevisionsPerInterval` | required | Maximum new reservations per Workspace rate interval. |
| `revisionIntervalMs` | required | Publication rate interval in milliseconds. |
| `maxAssetBytes` | required | Maximum decoded bytes per published asset. |
| `maxPublicationBytes` | required | Maximum complete input metadata and decoded asset bytes. |
| `maxAssets` | required | Maximum explicit assets per revision. |
| `maxMetadataBytes` | required | Maximum retained receipt bytes, reserved before asset capture. |
| `maxWorkspaceBytes` | required | Maximum retained blob and receipt reservations per Workspace. |
| `maxHostBytes` | required | Maximum retained blob and receipt reservations across Workspaces. |
| `maxOperations` | required | Maximum retained publication reservations across Workspaces. |
| `maxRevisionsPerArtifact` | required | Maximum committed revisions retained by one artifact. |
| `pageSize` | required | Maximum catalogue, history or recovery records per page. |


-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider reserves quota, writes and verifies immutable attachments, persists a manifest receipt, appends its creating Session publication event, and flushes the Session before acknowledging its catalogue head. Expected-head edits serialize through a bounded queue. Pending receipts recover from exact persisted events; explicit reconciliation safely abandons absent events while retaining storage accounting. The optional `./invariant` companion compares each live publication event with its separately retained manifest receipt. Startup and publication enforce revision chains, durable commit evidence and blob integrity.

The [source entry](src/index.ts) owns the exact service or registration behavior.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Artifact subsystem](../../../docs/subsystems/artifacts.md) — immutable publication and presentation protocol.
- [Using artifacts](../../../docs/user/artifacts.md) — trusted controls and runtime qualification.
- [Architecture](../../../docs/architecture.md) — composition and capability ownership.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through artifact tool Consumers, which own the persisted model-visible arguments and results.

#### KV Cache effect

This package adds no model request prefix; its Consumers own any cache effects.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These constraints determine supported use.

- Storage admission counts retained and abandoned reservations; there is no automatic history pruning. Catalogue mutation has one provider writer per storage domain. A missing or corrupt attachment refuses content.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
