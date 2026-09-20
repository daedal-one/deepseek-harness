---
id: TASK:sandbox/conversation-git-workspace
type: task
status: accepted
summary: Implement transparent conversation-owned Git import, private recovery, fallback commits, and automatic host branch return.
owners: [carlo]
progress: done
addresses:
  - REQ:sandbox/isolated-execution-world#c-world
  - REQ:sandbox/isolated-execution-world#c-lifecycle
  - REQ:sandbox/isolated-execution-world#c-data
  - REQ:sandbox/conversation-git-workspace#c-ownership
  - REQ:sandbox/conversation-git-workspace#c-import
  - REQ:sandbox/conversation-git-workspace#c-boundary
  - REQ:sandbox/conversation-git-workspace#c-storage
  - REQ:sandbox/conversation-git-workspace#c-agent
  - REQ:sandbox/conversation-git-workspace#c-finalize
  - REQ:sandbox/conversation-git-workspace#c-message
  - REQ:sandbox/conversation-git-workspace#c-recovery
  - REQ:sandbox/conversation-git-workspace#c-return
  - REQ:sandbox/conversation-git-workspace#c-outcomes
  - REQ:sandbox/conversation-git-workspace#c-evidence
labels: [sandbox, workspace, git, recovery]
assignee: carlo
---

# Conversation Git workspace

## Design owner

The [conversation workspace decision](../../.agents/notes/implemented/architecture/2026-09-20-conversation-git-workspace.md) defines the lifecycle, transactions, failure behavior, and supported repository limits. The opt-in implementation covers preparation, recovery, automatic residual commits, immutable host result branches, and independent UI/SDK receipts. No shipped profile or running service enables it automatically.

Validation includes a real rootless Podman Loader flow, deterministic restart fault injection, affected consumer tests, a recorded Session and TypeScript wire expectation consumed by both SDKs, and a browser check. Models are scripted in these checks; physical host-reboot testing and paid subject-generation quality are outside this evidence.

## Delivery order

1. Add durable workspace ownership, conversation-bound service routing, mutation leases, storage quotas, and recovery independent of process teardown.
2. Add bounded Git import, input-baseline creation, canonical execution paths, and instruction loading from imported content.
3. Add successful-turn finalization, residual-diff commits, the optional message-only LLM, and replay-safe commit transactions.
4. Add validated bundle return, compare-and-swap result refs, durable retry receipts, and independent client/SDK synchronization status.
5. Complete real-engine integration, crash and concurrency tests, model-visible Session snapshots, SDK expectations, and real GUI evidence before enabling the deployment.

## Acceptance

A coding agent can complete ordinary work in an imported repository using existing tools and granular Git commits. Every successful turn automatically preserves and returns its committed result without source-checkout mutation or remote publication. Private checkpoints recover dirty interrupted work. Every failure is attributable to import, execution, finalization, checkpoint, or return, and retries never duplicate commits or overwrite external work.
