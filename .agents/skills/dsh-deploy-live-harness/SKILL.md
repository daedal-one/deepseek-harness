---
name: dsh-deploy-live-harness
description: Use when preparing, deploying, redeploying, updating, or restarting the live DeepSeek Harness. Separates verified workspace preparation from human-confirmed host handoff and uses an operator-owned deployment definition for candidate qualification, external activation, authenticated verification, and recoverable failure.
---

# Deploy the live Harness

Use this workflow for the running Harness, not npm publication, website deployment, or a development preview. A skill supplies instructions, not host authority or an executable deployment controller. Never invent a `dsh upgrade` command. The [host-maintenance reference](../../../apps/cli/reference/README.md#host-maintenance) and [handoff contract](../../../packages/integration/daedal-handoff/README.md) own runtime behavior.

## Required inputs

For deployment, require a candidate Git revision or a request to prepare one and an operator-owned deployment definition. Require a configured host-handoff target when transferring out of isolation or requesting a different maintenance session. The definition can be supplied with the task or identified by an explicit path; read it before using it. Do not search guessed host locations. A missing definition permits workspace preparation and a handoff for **deployment configuration inspection only**, not activation.

The deployment definition must identify:

- The repository and immutable candidate revision, installation/release root, and current release identity source.
- The maintained service's exact unit and manager scope, launch profile, Harness home, public URL, and the source of its effective command and environment. List companion capabilities and configuration that must remain available.
- The independent maintenance session and external activation controller that survive stopping the maintained service. Include the controller's exact entrypoints, operation identity, durable status/receipt location, timeout, and concurrency protection.
- The exact preparation and qualification commands, alternate listener, separate disposable state, authenticated readiness checks, and cleanup. Candidate qualification must not write production Session data or take the production listener.
- The activation command, verification commands, expected revision and authenticated response, and the source of authentication. Refer to credentials without copying their values into tool arguments, summaries, or receipts.
- The retained working release, backup policy, Session-format compatibility assessment, and exact permitted recovery commands. A process rollback must not overwrite newer Session data with an older backup.

If a required value, command, success condition, or recovery action is absent, report the missing field and stop before the affected stage. Do not substitute a generic build, guessed systemd unit, unauthenticated HTTP 200, or a second application server.

## Inspection-only branch

If the deployment definition is missing or the request is to standardize deployment configuration, transfer the known repository/service references and missing fields for inspection only. No candidate publication is required for this branch. A delegated specialist reports the complete handoff requirement to its parent; only the live root performs destination discovery and confirmation.

In the confirmed host destination, inspect only operator-supplied service/configuration references and the configured destination workspace. If those references are missing, ask the user for them rather than guessing paths or service names. Record the effective permission preset, file policy, approval policy, reviewer activation, actual service command, and controller/recovery evidence. Produce or revise the operator-owned deployment definition through the authorized file workflow. Stop after reporting missing inputs and the definition; do not qualify or activate a release under an inspection-only request.

## 1. Prepare in the workspace

For a deployment request with a supplied definition:

1. Read the current execution and permission context. Determine execution placement independently of file access. A permission label such as `Host maintenance` is not evidence of host placement or review exemption.
2. Resolve the requested revision to an immutable commit. Preserve unrelated work. Run the checks selected by [dsh-pre-push-checks](../dsh-pre-push-checks/SKILL.md); record commands, exit status, and missing verification. Do not describe an uncommitted working tree as that commit.
3. Publish the required committed work through the authorized repository workflow before deployment handoff. If no authorized publication path exists, stop and report that the destination cannot obtain the candidate. A handoff does not copy uncommitted files or jobs.
4. Prepare the handoff task using the template below. Distinguish candidate changes from deployment-configuration inspection and activation. Do not report host readiness from workspace checks.

## 2. Transfer host work

If the current execution context is isolated, stop host work here. Delegated specialists report the complete handoff requirement to their parent and do not call the handoff tool. The live root uses `handoff_to_host` without `target` to discover configured destinations, then selects an exact returned target and requests human confirmation. Make each handoff the only tool call in its response. Do not probe host processes, guessed paths, or source-session localhost. Do not escalate file permissions to leave isolation.

Include this task summary:

```text
Objective: deployment inspection only | qualify and activate
Candidate: repository, published branch, immutable commit
Workspace checks: exact commands and outcomes; outstanding checks
Deployment definition: explicit path or supplied definition; missing inputs
Destination: discovered target and resolved permissions
Remaining stages: host preflight, preparation, qualification, activation, verification
Working release and recovery: known evidence or explicit unknowns
Instruction: load dsh-deploy-live-harness in the destination before host work
```

A declined or unavailable handoff stops host work. An unknown delivery outcome requires inspection of the returned destination Session identity; never automatically submit another transfer. After success, host work continues only in the destination, which reloads this skill. The source may report the receipt but must not execute the destination's stages.

## 3. Host preflight

In the destination, verify current context says host, read the deployment definition, and inspect its declared service command and release identity using the supplied commands. Confirm this maintenance session and activation controller are independent of the maintained service. If restarting the target would terminate the maintenance session or controller, stop; request an independent configured destination instead.

Compare effective file access, approval policy, and active tool-policy review with the approved destination. Stop on an unexpected change. Do not disable enforcement, change permission presets, run through another tool, or use a helper server to bypass review.

Handle permission feedback by its stated mechanism:

- A file-sandbox denial permits only the exact wider-mode retry advertised by the tool and current approval policy, within this same execution world.
- A tool-policy deferral is not a sandbox denial. If the operation is still necessary and authorized, retry the **same tool with unchanged arguments** only as its configured approval threshold permits. Do not add `sandbox_permissions`; an intervening tool call or argument change starts a new chain.
- A deterministic policy denial, rejected approval, disabled approval, or unavailable answerer stops that operation. Report the reason; do not cycle retries or invent another approval route. `never` rejects approval requests; it does not grant them.

## 4. Prepare and qualify the candidate

Run the definition's preparation and qualification commands for the exact commit. Preserve the working release and companion configuration. Verify the candidate's authenticated readiness and revision on its alternate listener with separate state. Collect outputs and clean up qualification resources using the declared commands on both success and failure.

Any failure stops before activation. Report the failed command and bounded diagnostic. Do not activate a partly built candidate or infer compatibility from process startup.

## 5. Activate externally

Before production state can change, verify the retained working release is available, execute and verify required backups through the definition's commands, and record the Session-compatibility assessment and permitted recovery path. If candidate startup or migration can write production Session data without a safe documented recovery path, stop before activation. A backup is not permission to overwrite subsequent Session data.

Use only the definition's authorized external controller, with its candidate and operation identity. Do not directly restart the process hosting this session, replace the active release in place, or launch a replacement Harness server.

Record the operation identity before waiting for its result. Cancellation, disconnection, or timeout can leave activation accepted: inspect the controller's durable receipt/status before doing anything else. Do not resubmit an uncertain activation automatically.

## 6. Verify or recover

Verify the actual service command, active immutable revision, authenticated readiness at the declared live URL, and required companion capabilities. A successful controller exit or open port alone is insufficient.

On failure, follow only the definition's permitted compatibility-aware recovery. If recovery is unsafe or unspecified, preserve release and Session data, report the failed verification and controller receipt, and stop. Never restore an older Session backup over newer production data.

Report one outcome: `prepared`, `handed off`, `qualified`, `activated and verified`, `recovered`, `failed`, or `unknown`. Include candidate and prior release identities, checks actually run, controller/Session receipt, recovery performed, and remaining work. Claim deployment success only for `activated and verified`; this skill's repository tests do not establish live-host readiness.
