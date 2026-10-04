---
description: "Save and retrieve immutable outputs by Workspace and revision. Each output records its creating conversation and explicit published assets. Use a durable provider to retain history independently of the creating execution environment."
kind: "package-reference"
---

# @deepseek-ai/dsh-artifact

## Summary

Save and retrieve immutable outputs by Workspace and revision. Each output records its creating conversation and explicit published assets. Use a durable provider to retain history independently of the creating execution environment.

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

Consume `ctx.artifacts` through the [durable provider](../artifact-durable/README.md); the abstract definition does not supply storage. Import browser-safe identities and manifests from `@deepseek-ai/dsh-artifact/types`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The service separates immutable publication from rendering. Its closed profiles declare published assets and, for interactive-local, transient input. Every operation retains exact Workspace ownership. No invariant companion is published because this definition owns no independent state; the provider checks its ledger and stored bytes.

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

- No renderer, file discovery, sharing ACL, or provider fallback is supplied.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
