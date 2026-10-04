---
description: "Add durable Workspace artifact tools, authenticated discovery and trusted revision controls to a base-backed Web or Desktop profile. Independent executable rendering remains unavailable until its provider is explicitly enabled with qualified deployment values."
kind: "package-bundle"
---

# @deepseek-ai/dsh-artifacts-bundle

## Summary

Add durable Workspace artifact tools, authenticated discovery and trusted revision controls to a base-backed Web or Desktop profile. Independent executable rendering remains unavailable until its provider is explicitly enabled with qualified deployment values.

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

From the repository root, add the source bundle to a selected base-backed Web or Desktop profile:

```sh
pnpm dsh plugin --profile artifact-doc-check add link:./packages/bundle/artifacts
pnpm dsh --profile artifact-doc-check --dump-config
pnpm dsh plugin --profile artifact-doc-check remove @deepseek-ai/dsh-artifacts-bundle
```

The selected profile must already have a Web or Desktop base. The add and remove operations use the normal [profile plugin workflow](../../boot/app-boot/README.md#profiles); the source link does not assert a published npm release. The patch mounts durable storage, model tools, the authenticated API and the Client menu and viewer. Removing it removes the contributed controls while retaining durable content.

The [patch](cordis.patch.yml) contains explicit deployment limits. Review them for the installation. Each revision declares either document or interactive-local policy; neither policy inherits Session permissions.

### Enable a qualified runtime

The runtime row starts disabled. Supply `DSH_ARTIFACT_SOCKET`, `DSH_ARTIFACT_IMAGE` and `DSH_ARTIFACT_SECCOMP` through the normal application environment, then enable the `artifact-runtime` row with a profile patch. The image must be pinned by registry digest; the seccomp path belongs to the Engine host. The [runtime README](../../artifact/artifact-runtime-podman/README.md) owns image construction, effective isolation checks and resource qualification. A rejected runtime configuration fails startup; an intentionally disabled runtime preserves source, history and export with an explicit preview-unavailable state.


-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle contributes one ordinary profile patch and no runtime service of its own. Storage, API, tools and Client controls have separate capability owners, and registrations are removed through their normal effects. No invariant companion is published because this package owns only static composition.

The [artifact subsystem](../../../docs/subsystems/artifacts.md) defines immutable publication and independently owned execution.

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

- Only base-backed Web and Desktop profiles provide the complete Consumer services. Other profile compositions must add their required owners explicitly. Sharing, persistent application state and network access are outside this bundle.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
