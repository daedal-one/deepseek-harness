# Agent Note: An issue-reporting channel for agents

Status: proposed

## Problem

An agent that hits a defect, a misconfiguration, or an environment condition it cannot remedy has no in-band way to report it. This session produced a concrete instance: every call to `handoff_to_host` failed with `Invalid option: expected one of "daedal"|"daedal-openai"`, including the documented discovery call that omits `target`. The cause was not the arguments. `packages/integration/daedal-handoff/src/index.ts` parses the calling session's own `agentPreset` projection with `daedalPreset` — a closed enum of `daedal` and `daedal-openai`, declared in `packages/integration/daedal-handoff/src/protocol.ts` — before it fetches the target catalog, so a session whose projection is absent or names another preset is rejected at the first statement. Neither the error nor the tool description names the projection value that was read, so the agent cannot distinguish "this deployment configures no handoff targets" from "this session's preset is not accepted" from "the `agentPreset` projection is not composed here".

The agent could not fix the condition and had no route to report it. The failure reached the user as conversation prose, which is not durable evidence, cannot be counted or deduplicated, and is lost with the session. Nothing asked the agent to attach the session id, the failing call, the harness revision, or the effective configuration to the observation, and nothing routed it to an owner.

The gap is general, not specific to handoff. Misconfiguration (a profile that omits a required row, a permission default that contradicts a preset, a credential provider that resolves nothing), harness defects (a projection value that never lands, a tool that rejects valid input), and environment conditions (a container that cannot start, a sandbox that denies an operation the policy permits) are all observable by an agent and all currently unreportable except as text.

## Proposal

Add a model-facing `report_harness_issue` tool, owned by a Host-side reporting capability, that records one structured report per call: a category (`defect`, `misconfiguration`, or `environment`), a one-line summary, the observed behavior, the expected behavior, and the reproduction the reporter believes is minimal. The Host stamps the facts the reporter should not have to supply or could forge — the source session id, the tool call id, the harness revision, the effective agent preset, the composition rows that own the failing surface, and the read time — and returns a durable receipt id that a later turn or a different session can cite.

Reports land in a Host-owned sink the operator chooses, selected the way telemetry and settings already select a provider, and outside the model transcript. A broken reporting path must not fail the calling turn: an unavailable sink answers `unavailable` with its reason, exactly as `handoff_to_host` does today.

The second half is diagnosis. A report is only actionable if the reporter can state the condition it observed, so the effective configuration facts a surface decides on — the session's projection values, the composed profile rows, and the resolved permission and sandbox facts — need a read-only introspection the agent can quote. A surface that answers with a message omitting the input that failed forces the agent to guess, which is what happened here.

This note proposes the capability, not a host integration. The sink location, retention, and whether a report is also opened upstream stay operator decisions.

## Alternatives considered

**Rely on conversation text, the status quo.** It preserves the observation but not as data: no id, no category, no revision, no deduplication, and no owner. It also asks the user to transcribe the report, which is exactly what this session had to do.

**Reuse `handoff_to_host` for reporting.** It already reaches the host and asks a human, but it exists to start another session under a different profile and cannot describe a condition of the current session without a destination. It is also the tool that failed here; a broken surface must not be the only route to report that it is broken.

**File an upstream issue directly from the agent.** It conflates a deployment misconfiguration with a product defect, needs network credentials the agent must not hold, and yields low-quality reports without operator triage. Routing to an operator sink keeps that decision human.

**Write only a `harness/issue` session event.** Durable and cheap, but it returns no receipt and has no resolved/unresolved lifecycle, so a reporter cannot tell whether anyone saw it.

## Acceptance criteria

A model reports one issue in a single call and receives a durable receipt id. The report carries the source session, the harness revision, the effective preset and the composition rows behind the failing surface, and the reproduced behavior, and it survives the session that filed it. An unavailable sink answers `unavailable` and never fails the calling turn. An operator can read reports without reading model transcripts.

## Risks

A reporting tool invites noise. Without categories, deduplication, and a review step, the sink fills with reports that describe the reporter's confusion rather than a harness condition, and a receipt must not imply that triage happened. Reports carry environment detail, so redaction of secrets and host paths has to be a property of the recorded schema rather than the reporter's discipline. Exposing effective configuration for diagnosis widens what an agent can read, so the introspection must stay read-only and must never surface credentials.
