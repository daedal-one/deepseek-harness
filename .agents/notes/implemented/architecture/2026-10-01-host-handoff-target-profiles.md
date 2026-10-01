# Agent Note: Host handoff target profiles

Status: implemented

## Problem

Coding and host maintenance need different tools and permission defaults. Reusing the source agent preset for an approved handoff ties destination authority to the coding session. Auxiliary host providers inside a VM preset also caused environment discovery to label VM commands as host execution.

## Decision

The authenticated receiver owns an explicit target catalog. Each target fixes a system-trusted agent preset and workspace. Discovery resolves that preset's permission default against the destination's permission table. The source selects a catalog identifier; human review shows the target, execution environment, workspace, agent preset, sandbox, approval policy, and complete task. Admission revalidates the reviewed settings and verifies the resulting session's host placement and permissions before prompting it. The source's preset and access settings remain independent. Host coding sessions can also request a destination with another policy.

Execution discovery follows the context supplying the preset's shell and its filesystem and subprocess dependencies. When a preset supplies no shell, the inherited execution context remains authoritative. Nested helper providers do not select the command environment.

The [host-maintenance profile decision](2026-09-21-host-maintenance-profiles.md) remains authoritative for separate sessions, explicit approval, credentials, and uncertain acceptance. The [admitted host conversation decision](2026-09-23-admitted-host-conversations.md) retains its explicit operator admission requirements.

## Alternatives considered

**Copy source settings.** Coding permissions and model tools do not express the operator's maintenance policy.

**Accept arbitrary destination composition.** A model-selected preset or workspace outside the configured catalog would bypass operator ownership of host authority.

**Scan every provider in a preset.** Auxiliary instruction readers and browser helpers can use host services while coding commands execute in a VM.

## Consequences

The private receiver protocol uses version 2; source and receiver must be upgraded together and receivers require explicit targets. Each approved transfer creates a separate ordinary session containing the summary and source reference. Profile changes require a new confirmation. Refused admission can leave an empty destination session but starts no task. Existing released Session generations and execution-environment resume checks remain intact.
