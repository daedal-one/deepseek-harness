---
description: "Reproducible Incus shared-volume qualification and remaining harness activation checks."
kind: "reference"
---

# Shared VM qualification

## Summary

This record separates Incus infrastructure checks from harness and UI acceptance. Infrastructure success does not establish that conversations use the shared runtime. Run destructive or interruption cases only against the qualification environment; preserve production repositories and retained conversation work.

## Table of Contents

- [Infrastructure evidence](#infrastructure-evidence)
- [Repeatable volume probe](#repeatable-volume-probe)
- [Harness acceptance](#harness-acceptance)
- [Dev Note](#dev-note)

## Infrastructure evidence

On 2026-09-29, the existing server's Incus 6.0.0 installation provided project `dsh-vm-verify`, storage pool `dsh-vm-test`, bridge `dshvmtest`, and ACL `dsh-vm-test`. The project contained no instances before provisioning. The shared VM is `dsh-c533cb44dc73b913f0a49eb85cb609f0`, derived from environment `daedal-development`. Its pinned image is `04d6cc76ecf40e08ea76be7aa8798695f30cd3fd4ebb21dd896bc56744548588`; resources are 4 CPUs, 8 GiB RAM, and a 64 GiB root disk. Automatic host-boot startup is disabled pending deployment qualification.

| Host source | Guest target |
|---|---|
| `/home/carlo/.local/share/dsh-server/environments/daedal-development/workspace` | `/workspace` |
| `/home/carlo/devel/deepseek-harness` | `/workspace/deepseek-harness` |
| `/home/carlo/devel/phoebe-lab` | `/workspace/phoebe-lab` |

Guest `findmnt` reported `virtiofs` and read-write access for all three mounts. Guest `df` reported about 56 GiB free on the root disk and 366 GiB on the workspace's host-backed filesystem. The host mount uses `/dev/md2` with ext4. Guest-root file creation produced host UID 1000, verified by the probe. Docker 29.1.3, Compose 2.40.3, and Node 24.21.0 were available. Read-only Git checks returned the host repositories' current revisions. The main harness service remained active and unchanged throughout these checks.

## Repeatable volume probe

Run this command from the checkout on the existing server:

```sh
python3 packages/sandbox/local-container-runtime/tests/vm/shared-volume-probe.py \
  --incus /usr/bin/incus --project dsh-vm-verify \
  --instance dsh-c533cb44dc73b913f0a49eb85cb609f0 \
  --workspace /home/carlo/.local/share/dsh-server/environments/daedal-development/workspace
```

The recorded execution sent this exact checked-in script over SSH to `python3 -` with the same arguments. It passed bidirectional file visibility and ownership checks, wrote 1,074,790,400 non-sparse random bytes, matched host and guest SHA-256, stopped one unique transient systemd unit while another remained active, and read the same file from fresh Incus attachments. The recorded SHA-256 was `ae542bbdf14d5e5babfa46b4fc749e3c19e5eac776a19512e0b5a04f99067a04`. Cleanup stopped only its unique test units and removed only its temporary directory; it did not change repository files or stop the VM.

This probe does not test the harness transport, harness restart, VM reboot, 64 GiB files, browser sessions, or credential handling.

## Harness acceptance

The server regression command below passed all 250 tests across 21 files after building the native addon, including attachment-loss cleanup and unavailable-cleanup reporting. The admission-deadline test controls `AbortSignal.timeout` directly because fake `setTimeout` does not advance that native timer. Transfer-generated AppleDouble metadata was removed from the qualification copy before the successful run.

```sh
pnpm run build:native-system
pnpm exec vitest run packages/sandbox/local-container-runtime/tests packages/fs/fs-local-container/tests packages/subprocess/subprocess-local-container/tests
```

The complete Linux `pnpm run build` passed. `pnpm run doc-sync` passed all 32 checks. The profile and profile-sandbox suites passed 58 tests, the selected built-CLI smoke passed, and the `workspace-save-cancelled`, `workspace-terminal-failure`, and `bash-tool-turn` recorded-session snapshots passed. Affected-package TypeScript compilation and `spec lint` also completed; spec lint reported 0 errors and 177 warnings. The local native build failed against the macOS SDK; native regression evidence comes from Linux.

Full-repository lint is not clean. The unchanged baseline reproduces findings in OpenRouter spend, legacy workspace code, and other unrelated files; the separate baseline copy also has unresolved built-type diagnostics, so its total is not comparable. Focused lint of the shared runtime, command transport, and new tests passes. No lint suppression or hook bypass is part of this qualification.

The real-provider test in [shared-vm.e2e.ts](shared-vm.e2e.ts) passed on the existing server in isolated checkout `shared-vm-Z6hq7l`. It mounted two independent Cordis contexts, verified bidirectional file changes through the filesystem provider, mapped both repositories through filesystem and subprocess providers, cancelled one real guest command while the other stayed active, disposed both contexts, and successfully reattached to the retained VM and files. This checks provider disposal, not a complete main-service restart or an authenticated conversation.

The latest transferred source also passed `pnpm exec tsc -b packages/sandbox/local-container-runtime packages/fs/fs-local-container packages/subprocess/subprocess-local-container` on Linux, together with a repeated real-provider test after the filesystem path adjustment.

The following cases remain required before activation. Record each command, source revision, outcome, and retained evidence when executed.

| Case | Required observable result |
|---|---|
| Shared runtime unit and Loader tests | Missing VM, mount drift, RAM-backed directories, command limits, cancellation, and shutdown have finite outcomes; no VM deletion or Git transaction occurs. |
| Real provider composition | Filesystem, subprocess, shell, terminal, instructions, and workspace UI resolve both configured host paths to the same guest mounts. |
| Concurrent conversations | Two sessions observe edits to the same file and Git index; cancelling one leaves the other's command alive. |
| Harness restart | A large file's hash, installed guest tool, and separately started guest service survive disposal and reattachment. |
| Transport loss | Killing one local Incus attachment does not leave its owned command running or affect another command. |
| Large disk workload | At least 64 GiB of real written data remains readable without workspace serialization or proportional harness-memory growth; record disk usage, memory, and hashes. |
| Missing and changed configuration | Startup reports an actionable failure without creating an empty replacement VM or retrying forever. |
| Retained conversation recovery | Recovered CLM changes are on `codex/recovered-clm-20260929`; Phoebe's retained commits are on `codex/recovered-conversation-20260929`. Both original conversation directories remain intact. |
| Harness code ownership | The effective service executable is in the managed release directory outside both guest-writable repositories. Discovery and handoff patches select packaged plugins, not repository source. The working directory alone does not identify the running release. |
| Authenticated UI | Daedal-OpenAI completes a real tool-using turn on the existing main service, with no workspace save/wait barrier or host-execution fallback. |

## Dev Note

The environment is provisioned but not attached to the live UI. No activation, source commit, or full reliability qualification is recorded here.

Retained conversation directories `/home/carlo/.local/share/dsh-server/workspaces/cc76b316faf34bd79c27e9076af69673/workspace` (about 5.1 GiB) and `/home/carlo/.local/share/dsh-server/workspaces/ab90725a86f349d8a420a08277f511c2/workspace` (about 355 MiB) remain untouched after user-authorized reconciliation. CLM's uncommitted source files were copied to its recovered branch without dependency caches. Phoebe's committed history was fetched into its recovered branch. The host's original untracked `oom` file is preserved in `/home/carlo/.local/share/dsh-server/recovery/reconcile-clm-gveCh0qK`.
