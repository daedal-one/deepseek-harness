# Agent Note: Forge session adapter and accountable tool plane

Status: implemented

## Problem

Forge had accepted DeepSeek Harness as its first coding-harness adapter, but the fork exposed no `forge.agent.session/v1` endpoint. Its general coding compositions also published local filesystem and shell tools directly, so a Forge session could not prove that it started from accepted intent or that all workspace reads, mutations, commands, diffs, and checkpoints entered Forge Intellect.

## Decision

`@deepseek-ai/dsh-forge-session-adapter` translates the Forge protocol at an authenticated HTTP boundary. It requires a canonical executor workspace that Forge has already allocated and refuses `start` unless Forge supplies a digest-checked `forge-spec-v0.6.0` or `forge-spec-v0.7.0` agent render for the exact intent revision, zero lint errors, and correlated `forge.intellect.action/v2` preflight evidence. The render is injected before any user message can drive a model request.

Each adapter-created Agent receives a scoped `dsh-mcp-client` instance connected to `forge-intellect-action-mcp`. The exact five action tools are the entire model-visible workspace surface. Reads proceed; mutations and commands use the Harness approval seam. The adapter returns at an approval boundary so Temporal can send a later `approve` command without deadlocking the active turn.

Adapter event sequences, causality, and command responses are durable and idempotent across process restart. Checkpoint and diff commands publish Intellect evidence. Close reconciles external bytes and reads final watermarks before disposal; evidence and cleanup failures are explicit terminal outcomes.

## Alternatives considered

**Let Forge call the existing JSON-RPC coding-agent demo.** Rejected because that surface neither negotiates Forge capabilities nor composes per-session Intellect tools and approvals.

**Keep local shell and filesystem tools and mirror telemetry afterward.** Rejected because post-hoc observation cannot establish the exact bytes read or the causal action that changed them.

**Treat Forge Intellect as the sandbox.** Rejected because the action gateway provides accountability and workspace containment, not network or process isolation. Forge still owns executor allocation and policy.

## Consequences

Harness-native events and persistence remain behind one versioned adapter while Forge owns durable work and lifecycle. Exact intent is model-visible and every workspace capability is attributable. A released adapter image must package a compatible action-MCP binary, and Forge must supply an isolated executor; a mutable sibling checkout is never a deployment dependency.

## Baseline compatibility

The adapter advertises both accepted baselines and preserves the supplied baseline in persisted startup intent. Forge reads the baseline from the committed configuration through its accountable action gateway and checks the native render against the exact clean revision, baseline, and work target. Unknown baselines stop dispatch; accepting v0.6 envelopes from compatible clients does not migrate or relabel their intent. Forge workers packaged with Spec 0.8 require a committed v0.7 project because canonical v0.6 exports omit some strict lint checks and cannot substitute for dispatch lint. The same render digest, lint, revision, target, and evidence checks apply to both baselines.
