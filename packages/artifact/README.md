---
description: "The artifact group: retained Workspace outputs, immutable revisions, independent execution and model tools."
kind: "package-group"
---

# artifact/ — Durable Workspace outputs

## Summary

Save generated outputs independently of their creating execution environment. Retain immutable revisions and browse them by Workspace. Choose a qualified runtime for local interaction without Session authority. Source access and exports remain available when executable presentation is unavailable.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Each package owns one part of publication or presentation.

| Package | Role |
|---|---|
| [artifact](artifact/README.md) | Immutable publication Service Definition and manifests |
| [artifact-durable](artifact-durable/README.md) | Retained revisions, quota, ownership and publication recovery |
| [artifact-runtime](artifact-runtime/README.md) | Independent presentation Service Definition |
| [artifact-runtime-podman](artifact-runtime-podman/README.md) | Qualified rootless browser presentation Provider |
| [tool-artifact](tool-artifact/README.md) | Model publication, discovery, read and restoration Consumers |

<a id="related-documentation"></a>
## Related documentation

- [Artifact subsystem](../../docs/subsystems/artifacts.md) — revision and invocation protocol.
- [Using artifacts](../../docs/user/artifacts.md) — the trusted Workspace interface.
- [Artifacts bundle](../bundle/artifacts/README.md) — opt-in profile composition.

<a id="dev-note"></a>
## Dev Note

None.
