# Agent Note: Forge Hub Code workspaces

Status: implemented

English | [中文](2026-08-18-forge-hub-code-workspaces.zh.md)

## Problem

The DeepSeek Harness Web application owns a local Workspace registry, while Forge owns registered project identity, repository links, and application projections. Embedding the ordinary Web application in the Hub without joining those models would expose a second project list: operators could select a Forge project outside the frame and still land in a different recent Harness Workspace inside it. Letting the browser create missing paths would also turn an unauthenticated presentation parameter into project provisioning authority.

## Decision

`dsh-forge-project-workspaces` accepts a bearer-authenticated complete replacement from the Forge Hub. It validates `ProjectId` as `PROJECT:<slug>`, derives the managed path `/workspaces/forge/<slug>`, materializes the linked Forgejo repository only when no checkout exists, and reconciles the Workspace registry's membership, titles, and order. Missing replacement rows lose only their registry entry; directories and Session logs remain recoverable.

The browser runtime treats an absolute `?workspace=` value as initial-selection intent only. It waits until that exact path appears in the registered Workspace baseline, opens or creates that Workspace's blank Session, and never falls back to another recent project. The Hub performs synchronization before rendering the frame and supplies the selected managed path, so project choice remains a Forge projection while conversation behavior remains native Harness behavior. The Forge deployment keeps the Workspace browser for managed Session history, disables directory adoption, and rejects public Workspace create, rename, delete, and reorder RPCs, preventing an operator from writing a second roster through the embedded origin.

Repository credentials reach Git through the child process environment instead of a clone URL. Replacement requests serialize, and existing checkouts are never fetched or reset because preserving active edits is more important than making the directory mirror Forgejo automatically.

## Alternatives considered

**Let operators register directories in the embedded sidebar.** Rejected because the resulting list would not map one-to-one to Forge projects and a Harness-only Workspace could appear to be a Forge application.

**Encode the Forge ProjectId as a Harness WorkspaceId.** Rejected because WorkspaceId is a durable generated identity over a canonical path. Reusing an external identifier would couple the registry's storage semantics to one control plane and bypass its create/recovery rules.

**Make the Hub reimplement the conversation UI over the Forge session protocol.** Rejected for this slice because the Harness already owns the mature interactive browser experience. Forge retains its harness-neutral runtime for durable orchestration while the embedded provider-native UI remains an enrolled specialist surface.

## Consequences

The Forge Web deployment has a dedicated authenticated catalog route and persistent Harness state. Its project roster is rebuildable from Forge, but working directories intentionally survive unregistration and existing repositories intentionally stop short of automatic refresh. The Web process still executes with the authority of its mounted environment; this decision does not claim sandbox, network, credential, lifetime, or cleanup isolation.

Focused host composition tests cover authentication, one-to-one replacement, stable ordering, title reconciliation, retained directories, and identity rejection. Client runtime tests cover absolute deep-link parsing, current-session override, exact target selection, and waiting without cross-project fallback.
