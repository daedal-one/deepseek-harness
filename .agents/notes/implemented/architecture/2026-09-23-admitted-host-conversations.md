# Agent Note: Operator-admitted host conversations

Status: implemented

## Problem

A native scheduled maintenance loop must remain visible in the existing Web Host while ordinary conversations use container workspaces. A second Web service separates the conversation and schedule from the operator's daily UI.

## Decision

The conversation workspace owner accepts an operator-controlled allowlist of exact Session identities, presets, and directories. Admission requires a trusted standing preset with isolated filesystem, subprocess, and shell services identifying the host world. Descendants inherit admission from their live admitted parent; unrelated conversations and resume attempts require their own matching entry. Ordinary container preparation and settlement remain authoritative everywhere else.

The [host-maintenance profile decision](2026-09-21-host-maintenance-profiles.md) remains the independent launch option and the authority for explicit host handoff. This decision adds a mixed-Host admission path and does not turn a permission selector into an execution-world switch. The [conversation workspace decision](2026-09-20-conversation-git-workspace.md) still owns container checkpointing, recovery, and Git return.

## Alternatives considered

**A second Web Host.** It isolates the worker but hides its conversation from the operator's existing Session list and requires separate access management.

**Host providers for every conversation.** This removes the existing container isolation and is not an acceptable consequence of enabling one maintenance loop.

**A preset name alone.** Users can select presets when starting ordinary conversations. The exact Session and directory admission prevents that selection from granting host authority.

## Consequences

Maintenance presets are operator-trusted code and carry direct host authority. They own their filesystem and process services and receive no container checkpointing. Container-only repository and file services fail closed for them. The scheduler, transcript, approvals, and UI remain in the existing Host. A new conversation receives an explicit checkpoint handoff; released Session headers are never rewritten to change their preset.

## Testing

Real scoped filesystem and shell operations qualify host execution alongside the ordinary workspace lifecycle. Refusal cases cover identity mismatch, missing providers, split worlds, and unrelated children. Fresh-runtime resume retains the admitted execution choice. Real Linux container and deployed Web checks qualify isolation and visible timer delivery separately.
