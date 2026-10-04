---
description: "Open a Workspace\u2019s saved artifacts from its sidebar menu without selecting a conversation. View pinned source and previews, compare and restore revisions, edit text, and download exact original assets. Agent edits require an explicit trusted-shell gesture and include the selected revision text as ordinary user input."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-artifacts

## Summary

Open a Workspace’s saved artifacts from its sidebar menu without selecting a conversation. View pinned source and previews, compare and restore revisions, edit text, and download exact original assets. Agent edits require an explicit trusted-shell gesture and include the selected revision text as ordinary user input.

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

Mount the Host plugin and its Client half alongside uiWorkspace, sidebarRight, locale, layout, sessions and the artifacts Remote namespace. The [artifacts bundle](../../bundle/artifacts/README.md) inserts the feature. The menu contribution and open Workspace panel are effect owned.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Authored HTML and CSS never enter the app DOM. The preview displays only a bounded PNG and inert text from the independent runtime. Only trusted controls call editing, export, clipboard or Session prompt APIs. Revision and invocation checks retire stale loads and input. No invariant companion is published because authoritative revisions and invocations belong to Host providers; the UI keeps only cancellable presentation state.

The [source entry](src/index.ts) owns the exact service or registration behavior.


Immutable asset reads use `dsh-resource://artifact/<workspace>/<artifact>/<revision>/<asset>` addresses, the authenticated artifact Remote and Resource-owned cancellation. The Resource provider and viewer enforce retained-byte admission before adopting content. One root Workspace panel preserves a pinned selection across conversation switches; reopening its Workspace focuses that same panel. Durable publication invalidations refresh catalogue heads without replacing the selected revision.

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

### Trusted selected-text edit request

#### What the model sees

An ordinary logged `user/message` input identifies the exact Workspace, artifact, revision and selected source text, together with the user’s instruction. Preview interactions send no model input. The user request labels selected artifact content as untrusted data.

#### Token effect

Selected text and its JSON envelope count toward the request limit and conversation history; preview frames add no tokens.

#### KV Cache effect

Append-only user input preserves the earlier request prefix; newly selected content extends it.


## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These constraints determine supported use.

- Comparison currently shows source panes rather than a textual diff. Direct editing supports UTF-8 text assets. Preview pointer and keyboard forwarding provides viewport interaction, not a semantic accessibility tree.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
