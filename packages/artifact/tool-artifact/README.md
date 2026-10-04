---
description: "Publish durable outputs, find Workspace artifacts, read a retained revision and restore old content without losing history. The model supplies a complete asset manifest and chooses a stable retry key. Every operation uses the calling agent\u2019s Workspace."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-artifact

## Summary

Publish durable outputs, find Workspace artifacts, read a retained revision and restore old content without losing history. The model supplies a complete asset manifest and chooses a stable retry key. Every operation uses the calling agent’s Workspace.

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

Mount over tools, artifacts and workspaceRegistry with required maxResultBytes and timeoutMs. Use the [artifacts bundle](../../bundle/artifacts/README.md) for its bounded profile configuration. Asset content is explicit UTF-8 or canonical base64; no filename or URL discovers another dependency.
### Configuration

All listed fields are required deployment choices; the validated [Config declaration](src/index.ts) defines accepted ranges.

| Field | Default | Meaning |
|---|---|---|
| `maxResultBytes` | required | Maximum complete JSON text emitted as one tool result. |
| `timeoutMs` | required | Guarded tool execution deadline in milliseconds. |


-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Normal tool registration owns schemas, guarded execution, persisted arguments/results and pure presentation. Publication retries derive a Session-scoped identity from a stable caller key. The provider owns authorization, durability and optimistic edits. No invariant companion is published because this consumer stores no second artifact state.

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

### Tool schemas

#### What the model sees

The generated [artifact schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-artifact) expose publication, listing, exact revision reads and restoration. Publication declares closed capabilities and the stable retry-key requirement.

#### Token effect

The fixed schemas appear whenever the tools are visible. Full asset arguments and bounded JSON results add history proportional to the selected content.

#### KV Cache effect

Definitions remain prefix-stable while tool visibility and configuration are unchanged. Appended publication and read results extend retained history.


## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These constraints determine supported use.

- Whole publications remain in tool-call history until compaction. Base64 assets cost more tokens than text. Read results and complete publication metadata must fit the configured model result cap.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
