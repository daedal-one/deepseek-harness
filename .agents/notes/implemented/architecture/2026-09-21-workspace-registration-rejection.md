# Agent Note: Workspace Registration Rejection

Status: implemented

## Problem

Workspace registration combines filesystem validation and durable writes. A client cannot safely retry a failed request when the same error code covers both a missing directory and a persistence failure that may have committed. Treating every such failure as unknown prevents a user from correcting a mistyped directory.

## Decision

The registry wraps only canonicalization and directory validation in `WorkspacePathInvalidError`, before enqueueing registration writes. The original failure remains its cause. Persistence and rollback errors retain their types.

The Host emits `workspace/create-rejected` when its initial lookup fails before create, or when create reports the typed validation error. Already structured Remote failures retain their codes. Other registration failures remain `workspace/invalid-path`, which carries no non-publication guarantee. A definite rejection describes this request's lack of writes, not the absence of an existing registration at that path.

The generated create endpoint uses business semantic revision 2. The Host checks callers' compatibility expectations before invoking the Workspace command. Native feature admission separately controls availability. Request and result schemas remain unchanged; this changes no Session event or persistence generation.

## Alternatives considered

Classifying all `workspace/invalid-path` failures as rejection would permit duplicate attempts after uncertain writes. Client-side path validation cannot prove Host filesystem state. An additional preflight lookup alone cannot validate a later mutation because the directory can change between calls.

## Consequences

Native clients can offer an explicit corrected attempt after receiving the new rejection. They must retain uncertainty for lost replies and other dispatched failures. [Current-registration lookup](2026-09-21-workspace-registration-lookup.md) remains a separate read: neither presence nor absence determines an earlier request's outcome. No automatic replay is authorized.
