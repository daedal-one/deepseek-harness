---
description: "Find saved Workspace artifacts, inspect their capabilities and work with immutable revisions."
---

# Work with Workspace artifacts

## Summary

An artifact saves a generated document or small interactive application with its own revision history. Open the Workspace’s dropdown in the left sidebar and choose **Artifacts**. You can inspect source, compare revisions, restore an earlier version and download the exact published bytes. Rendered previews use a separately qualified runtime; opening an artifact grants it no access to your conversation or environment.

## Table of Contents

- [Open a saved artifact](#open-a-saved-artifact)
- [Change and restore revisions](#change-and-restore-revisions)
- [Understand capabilities](#understand-capabilities)
- [Recover an interrupted save](#recover-an-interrupted-save)
- [Qualify executable previews](#qualify-executable-previews)
- [Further Exploration](#further-exploration)

## Open a saved artifact

The Artifacts menu appears while the [artifacts bundle](../../packages/bundle/artifacts/README.md) is active. Its catalogue belongs to the Workspace whose menu you opened, including outputs from inactive and archived conversations. Select an artifact to open its current revision. The selected revision stays pinned when you change conversations or refresh the catalogue.

Use **Source** to inspect an explicit published asset and **Preview** to view the independently rendered entry. **Download** exports the selected asset’s original bytes. The downloaded file is outside the artifact sandbox; its execution uses the environment where you open it. Binary assets remain downloadable even when they have no text source view. The capabilities disclosure identifies the revision’s execution profile and excluded access.

## Change and restore revisions

**Edit text** replaces one text asset and saves a new revision. A concurrent change rejects the save; reload the catalogue, inspect the new head and reconcile your edit. **History** opens retained revisions, and **Compare** shows the selected source beside another revision’s source. **Restore** copies a historical revision into a new head, preserving every earlier revision.

Select source text, enter an instruction and use **Ask agent to edit** to submit a normal user message in that Workspace. The request includes the exact artifact, revision and selected text. Preview clicks cannot submit that request or invoke agent tools.

## Understand capabilities

Document artifacts display supported content with authored scripts disabled. Interactive-local artifacts can compute over their published assets and receive temporary pointer, keyboard and text input. They cannot use networking, persistent application storage, local files, credentials, conversation history or Harness tools. The trusted renderer receives no Session execution environment.

Preview state ends when its invocation closes. Published files remain unchanged until a trusted save creates a revision. A preview can end at its resource or lifetime limit; reopen it to start another invocation. If no qualified runtime is mounted, the viewer reports that rendering is unavailable and keeps source and history accessible.

## Recover an interrupted save

An interrupted operation appears under the catalogue’s recovery controls. **Recover** checks its durable publication evidence and either exposes the committed revision or abandons a reservation that never published. A failed save retains its retry identity while the viewer remains open, so retrying the same operation does not add a duplicate revision. Retained history and abandoned reservations count toward storage limits; admission refuses new work rather than pruning existing revisions.

## Qualify executable previews

Executable previews require a dedicated rootless Podman engine with effective cgroup-v2 CPU, memory and PID controls, a digest-pinned trusted browser image and the confined Chromium seccomp profile. The [runtime provider](../../packages/artifact/artifact-runtime-podman/README.md) owns image construction, required configuration and qualification. The bundle leaves this provider disabled until those deployment values are supplied and verified.

The qualified development setup uses a Linux ARM64 Podman engine. Other architectures and engines require their own qualification; selecting a different Session sandbox does not qualify artifact execution. The browser receives raster frames and inert text, so it has no authored DOM to activate. This initial viewer forwards viewport input rather than a semantic accessibility tree.

## Further Exploration

- [Install the artifacts bundle](../../packages/bundle/artifacts/README.md)
- [Artifact subsystem reference](../subsystems/artifacts.md)
- [Artifact runtime configuration](../../packages/artifact/artifact-runtime-podman/README.md)

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
