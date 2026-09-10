# Agent Note: Conversational Intellect verification

Status: implemented

## Problem

A user who wants to test code against Forge specifications has to assemble a native policy, execution command, agent adapter and retained-run commands. That setup obscures the evidence model and makes the workflow depend on knowledge of several repositories.

## Decision

The Deadal-intellect browser and headless profiles compose the existing Harness conversation, credentials, model settings, approval and job services with a native verification integration. A profile-owned preset provides the coding and verification instructions; ordinary profiles do not discover it. The assistant proposes exact checks and source scope, while the executor requires an approval of the immutable plan and rechecks the revision after approval.

Native Forge Intellect remains the only assessment and attestation authority. The integration calls its coordinator, routes retained packets over a private per-run socket into fresh Harness review agents, and preserves raw review sessions. Reviewers have no tools or inherited conversation. Credential values remain in the model provider and are absent from native child environments. Review input uses plugin provenance, so automated session titles do not add unplanned model requests over evidence packets.

## Alternatives considered

**Keep the workflow in an operator guide.** This preserves all native controls but leaves the user's onboarding problem unresolved. The profile makes those controls part of the conversation.

**Reimplement the evidence rules in the Harness.** This makes a second authority for freshness, complete scope and attestation. Delegating to native Intellect keeps existing controls and refusal behavior authoritative.

**Launch a separate direct AgentLoop adapter.** This duplicates credential setup and runtime composition and bypasses the supported profile launcher. The private helper transports packets to an already-running application; it does not launch an agent application.

**Let the main coding agent review its own conversation.** This couples the judgment to its implementation narrative. Fresh packet-only assessor and challenger sessions preserve independent evidence review.

## Consequences

Users need only the native executables and their Harness credentials, but the native installation remains a prerequisite. Checks run on the local machine in a disposable checkout and require explicit review; they are not an OS sandbox. Generated probes are disabled, so new test code is authored and committed before another plan. A single active job limits memory pressure. Custom verification storage must stay outside Git repositories, because native temporary test directories otherwise inherit an ancestor Git repository. Cancellation and restart preserve partial evidence and never imply a successful assessment.

The Forge session adapter and its accountable action plane remain a separate deployment integration. Its [owning decision](2026-08-17-forge-session-adapter.md) remains active because its authentication, executor and protocol boundaries are still current; this profile does not supersede it.

## Verification

The built profile runs real native capture, checks, reviews, status and attestation against a committed fixture. Deterministic model and approval fixtures prove passing code can qualify, failed assertions override supportive reviewer claims, denied or altered approvals start no job, and cancellation settles after cleanup. A recorded onboarding session pins the profile's model-facing instructions and tools. Transport and contract tests reject forged packets, duplicate reviewer calls and invalid citations. Real-profile fixtures exercise correction of forbidden response fields and refusal after repeated invalid reviewer replies.

The focused integration tests pass 26 cases, and existing launcher/profile regressions pass 66 cases. The new recorded onboarding conversation refreshes and replays successfully. Package TypeScript builds, type-aware lint, documentation gates and runtime dependency closure pass. A supplementary whole-host TypeScript build exhausts the explicitly limited 1536 MiB Node heap; whole-repository coverage and platform validation remain CI responsibilities.

The browser pilot on 2026-09-10 verifies `REQ:core/canonical-projection` at Forge Spec revision `eca03e6c9a6cee6ede309d3ab2660a901c54893b`. Run `a4163ea0-d486-47c2-a706-ab2274a1ea2a`, retained under the normal Harness verification directory, executes 156 passing tests with no failures and one optional ignored test. Native Intellect supports the owner and all six clauses and issues attestation `bb1415f7c56d7d82e0932f2a9d5f9656e0c13a35a12b1060444d023aeb3a6e54` with assessment `166640b1e59377ebbee91e29d7702837dc6f03ed63172584ec983b81bea1975c`. Both reviewers use the configured OpenRouter route; one final-response correction is retained. Earlier failed storage-isolation and invalid-reviewer runs remain preserved, with no attestation. The repeat uses the same source revision, check command and assertion markers.

After a full Harness restart, a fresh browser conversation discovers the retained run and retrieves all seven supported decisions with execution and reviewer freshness still current. It performs no new checks, reviewer calls or attestation. The temporary browser test instance is stopped after verification.
