---
description: "Browse retained outputs from an exact Workspace without activating a conversation. Open source or a qualified preview, edit text with an observed head, recover interrupted saves and restore retained content. The authenticated gateway resolves editing Sessions while the provider checks Workspace ownership."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-artifacts

## Summary

Browse retained outputs from an exact Workspace without activating a conversation. Open source or a qualified preview, edit text with an observed head, recover interrupted saves and restore retained content. The authenticated gateway resolves editing Sessions while the provider checks Workspace ownership.

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

Mount over typert, artifacts, sessions and workspaceRegistry. Set explicit catalogue subscription, viewer retention and trusted text bounds; artifactRuntime is optional. The [artifacts bundle](../../bundle/artifacts/README.md) supplies the Consumer configuration.
### Configuration

All listed fields are required deployment choices; the validated [Config declaration](src/index.ts) defines accepted ranges.

| Field | Default | Meaning |
|---|---|---|
| `maxCatalogueWatchers` | required | Maximum simultaneous catalogue invalidation streams. |
| `maxRetainedBytes` | required | Maximum retained viewer bytes, including decoded text and preview pixels. |
| `maxEditBytes` | required | Maximum replacement UTF-8 text bytes in a trusted edit. |
| `maxSelectionBytes` | required | Maximum logged agent edit request bytes, including its envelope. |


-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Read-only catalogue calls address immutable Workspace revisions. Each preview lease addresses one revision and independently owned invocation; the stream awaits invocation removal and closes on caller cancellation. Trusted edits preserve all other explicit assets. No invariant companion is published because the provider owns revision state and the runtime owns invocation state; this Consumer retains only revocable lease handles.

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

- This API assumes the authenticated Host’s existing Workspace access policy; it adds no sharing ACL. A missing runtime refuses preview and preserves source access.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
