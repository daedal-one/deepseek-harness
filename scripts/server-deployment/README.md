---
kind: reference
summary: Prepare an exact Harness commit and activate its approved qualification through independent systemd workers.
---

# Operator-owned server deployment

## Summary

The Linux controller builds a committed ancestor of remote master, qualifies authenticated Web startup and client assets on an alternate loopback port, and returns a digest for approval. An independent systemd worker activates that exact candidate and records its outcome after the submitting conversation disconnects. The operator owns the installation and deployment definition; ordinary source checkouts carry no host authority.

## Table of Contents

- [Use the controller](#use-the-controller)
- [Review Session compatibility](#review-session-compatibility)
- [Install the definition](#install-the-definition)
- [Preservation and recovery](#preservation-and-recovery)
- [Validation](#validation)
- [Known limitations](#known-limitations)

## Use the controller

The operator supplies the installed command and definition path in the host's agent instructions. The [deploy skill](../../.agents/skills/deploy/SKILL.md) carries that path into a confirmed host handoff. Commands use a fresh operation id of 8–64 lowercase letters, numbers, or hyphens, a full 40-character commit, and the 64-character qualification digest returned by status.

```sh
sudo -n /usr/local/sbin/dsh-deploy prepare OPERATION COMMIT
sudo -n /usr/local/sbin/dsh-deploy status OPERATION
```

Wait for `qualified`. Present its revision and `approvalDigest` to the user. Only after explicit approval, submit that digest and finish the conversation turn so the controller can observe an idle host:

```sh
sudo -n /usr/local/sbin/dsh-deploy activate OPERATION APPROVAL_DIGEST
```

Read status on reconnection. Success is `activated-and-verified`; `qualified` means preparation only. An uncertain submit must be inspected, never repeated. An exclusive activation request prevents a second execution under the same identity, including after failure. A new candidate, controller, definition, declared configuration file, service command, dependency reference, or built artifact requires a fresh operation and approval.

## Review Session compatibility

Before building, preparation compares the running and candidate commits under every configured `compatibilityPaths` entry. Changes produce `compatibility-review-required`, with an operation-specific report and `reviewDigest` in status. The report lists the exact revisions and changed files and binds the running command, controller, deployment definition, and declared configuration fingerprints. The policy remains unchanged throughout the operation.

An operator reviews the diff and supporting tests. A `rollback-compatible` decision attests both that the candidate reads existing data and that the previous release reads data the candidate can write. Record the relevant reader/writer analysis and test results in an evidence file. An unchanged format version or successful startup alone is insufficient. Do not include credentials or private Session contents. After explicit approval of that report and assessment, submit bounded JSON on standard input:

```json
{"decision":"rollback-compatible","evidence":"Describe the reviewed reader/writer changes and actual verification results."}
```

```sh
sudo -n /usr/local/sbin/dsh-deploy review OPERATION REVIEW_DIGEST < evidence.json
sudo -n /usr/local/sbin/dsh-deploy status OPERATION
```

The controller records the decision, evidence, submitting account, and time in an administrator-owned receipt, then resumes preparation through an independent worker. It rechecks the reviewed context before building and after qualification. The final qualification digest includes the report and decision; activation still requires explicit approval of that digest. Changed context requires a fresh operation and review. Review evidence is an operator assessment, not an automatically proven compatibility result.

For incompatible or unproven rollback, submit `migration-required` with the reason as evidence. That operation cannot continue to qualification or activation; a separately designed migration and recovery procedure is required. Duplicate reviews refuse replay. If submission is interrupted, inspect status and the operation's `compatibility-review.json` before taking further action. No configuration restoration is needed after either outcome.

## Install the definition

An administrator installs [controller.py](controller.py) at the declared `controller` path, a wrapper using isolated Python at the public command path, and `/etc/dsh-deploy.json`. The definition and controller must be root-owned and not group- or world-writable. The operations directory is root-owned with traversal permission for the service account; each private qualification home belongs to that account, while receipts and logs remain administrator-owned. Build and qualification logs are readable by the service account for diagnosis; full home archives remain administrator-only. The operator grants only the wrapper's `prepare`, `review`, `activate`, and `status` commands; internal worker commands are unavailable through sudo. Install controller updates while deployment workers are inactive. Controller changes invalidate earlier qualifications.

The definition explicitly supplies service identity, user identity, repository, release and receipt roots, locks, the final service override, live and qualification listeners, environment-file references, declared checks, persistence compatibility paths, preset files containing release references, companion units, idle check, and timeouts. Preparation refuses to rebuild the running or retained rollback release. The controller executes build commands and the candidate as the service account. Configuration files hold paths, not copied credential values. Environment files must use simple `NAME=value` assignments.

The main service continues to launch through `dsh --profile web`. The controller preserves its existing arguments and environment drop-ins and changes only the launcher path. It retargets existing release-owned profile links after proving their candidate targets exist; unrelated package aliases remain unchanged. Disable legacy update timers that write into the same release directories. The controller owns preparation; a competing builder could change qualified artifacts while approval is pending.

## Preservation and recovery

Activation holds the shared build and activation locks, waits for idle work, stops the maintained service, records every physical Session generation, and takes a quiescent home archive. It changes release references and the declared service override, starts the candidate, checks the effective process arguments, authenticated boot, every advertised client asset, companion liveness, and unchanged historical Session prefixes. Both activation and recovery wait for authenticated Web readiness and active companion units within `healthTimeout`; companion authentication may finish after Web startup. Only then does it publish the current-release marker and success receipt.

Automatic rollback is admitted when the configured persistence paths are unchanged or the exact operation has an approved rollback-compatible assessment. A failed activation restores the old launcher and release references, then verifies authenticated readiness. It never extracts the backup over the live home; new Session data remains in place. Keep the retained release and operation archive until operator review permits removal. The [compatibility-review decision](../../.agents/notes/implemented/architecture/2026-10-13-operation-bound-deployment-compatibility.md) explains the approval scope.

## Validation

Run the focused controller tests on Linux or macOS:

```sh
python3 -B scripts/server-deployment/test_controller.py
```

The tests exercise duplicate submission, changed approval, concurrent locks, candidate drift, busy-host refusal, qualification failure, dependency resolution, and recovery without history replacement. Compatibility cases cover pre-build review, real Git additions/deletions/renames, bounded evidence, migration refusal, review drift, interrupted submission, and qualification binding. Live acceptance additionally requires an operator-installed definition, real isolated qualification, and an approved activation receipt. Python fixtures do not establish live readiness.

## Known limitations

The controller targets systemd Linux hosts. Qualification uses copied profiles and settings with an empty Session store; it proves composition and authenticated assets, not replay of existing tasks. Preserved history is checked during activation. An abrupt machine loss can leave an operation uncertain; inspect its status, override, and retained release before operator recovery. The idle check and shutdown are separate operations, so a newly submitted turn can race shutdown and may need resumption. Logs and full archives are private because they can contain authentication and user data; do not copy their contents into public reports. Source lint and hosted CI remain separate from deployment evidence.
