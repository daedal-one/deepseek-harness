---
description: "Present an immutable output through a renderer with independently enforced restrictions. A caller supplies only verified published assets and bounded transient input. Closing or aborting an invocation ends its owned execution."
kind: "package-reference"
---

# @deepseek-ai/dsh-artifact-runtime

## Summary

Present an immutable output through a renderer with independently enforced restrictions. A caller supplies only verified published assets and bounded transient input. Closing or aborting an invocation ends its owned execution.

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

Consume `ctx.artifactRuntime` from a qualified provider. Import the browser-safe presentation protocol from `@deepseek-ai/dsh-artifact-runtime/types`. Hosts without a qualified provider offer source and export without executing content.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The closed input protocol has pointer, key and text messages, and no privileged request. Presentation contains a raster and inert accessible text. Each invocation has an unpredictable identity, an immutable revision and a quiescent completion promise. No invariant companion is published because the definition owns no runtime state; providers verify execution restrictions.

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

None, as this package registers no model-facing input.

#### KV Cache effect

This package adds no model request prefix; its Consumers own any cache effects.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These constraints determine supported use.

- The definition provides no fallback renderer or capability grants. Presentation is viewport based; providers own format support.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
