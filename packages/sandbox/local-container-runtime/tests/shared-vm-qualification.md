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

On 2026-09-29, the existing server's Incus 6.0.0 installation provided project `dsh-vm-verify`, storage pool `dsh-vm-test`, bridge `dshvmtest`, and ACL `dsh-vm-test`. The project contained no instances before provisioning. The shared VM is `dsh-c533cb44dc73b913f0a49eb85cb609f0`, derived from environment `daedal-development`. Its pinned image is `04d6cc76ecf40e08ea76be7aa8798695f30cd3fd4ebb21dd896bc56744548588`; resources are 4 CPUs, 8 GiB RAM, and a 64 GiB root disk. Incus automatic host-boot startup is disabled; the runtime starts an existing stopped VM after verification.

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

The same probe passed with `--size-mib 65536 --source /dev/zero --timeout 900`: 68,719,476,736 fully allocated bytes, SHA-256 `57b295ba06757c81edca2d1e299133b2f059bea28e6cf9f438d7741611c36541`, matching host and guest reads, cancellation isolation, and `virtiofs`. It asserts allocated disk blocks as well as logical size. The durable output is `/home/carlo/.local/share/dsh-server/qualification/shared-vm-64g.log`. An earlier SSH attachment lost its completion output; only the run with the retained log is counted as passed. Both probes cleaned up their own data.

This probe does not test the harness transport, harness restart, VM reboot, browser sessions, or credential handling. The harness tests and restart observations below provide separate evidence.

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

The following matrix separates observed behavior from remaining acceptance. Record each command, source revision, outcome, and retained evidence when executed.

| Case | Required observable result |
|---|---|
| Shared runtime unit and Loader tests | Missing VM, mount drift, RAM-backed directories, command limits, cancellation, and shutdown have finite outcomes; no VM deletion or Git transaction occurs. |
| Real provider composition | Filesystem, subprocess, shell, terminal, instructions, and workspace UI resolve both configured host paths to the same guest mounts. |
| Concurrent conversations | Two sessions observe edits to the same file and Git index; cancelling one leaves the other's command alive. |
| Harness restart | A large file's hash, installed guest tool, and separately started guest service survive disposal and reattachment. |
| Transport loss | Killing one local Incus attachment does not leave its owned command running or affect another command. |
| Large disk workload | The 64 GiB probe above passed without a workspace archive. This is a storage test, not a measured peak-memory benchmark. |
| Missing and changed configuration | Startup reports an actionable failure without creating an empty replacement VM or retrying forever. |
| Retained conversation recovery | Recovered CLM changes are on `codex/recovered-clm-20260929`; Phoebe's retained commits are on `codex/recovered-conversation-20260929`. Both original conversation directories remain intact. |
| Harness code ownership | The effective service executable is in the managed release directory outside both guest-writable repositories. Discovery and handoff patches select packaged plugins, not repository source. The working directory alone does not identify the running release. |
| Authenticated UI | Daedal-OpenAI completes a real tool-using turn on the existing main service, with no workspace save/wait barrier or host-execution fallback. |

## Dev Note

Release `fb64d9b304584c1f94b9990f6aa73a6dd19cf288` is committed and pushed on `codex/shared-environment-workspace`. The existing `dsh-sync.service` built it and completed its managed authenticated activation checks. Its source branch was updated explicitly; `dsh-sync.timer` remains disabled. The main service then restarted with the shared-runtime patches. The composed profile disables the disposable runtime, includes `/shared-vm`, and omits the conversation-workspace supervisor and repository-access tool. Configuration backups are in `/home/carlo/.local/share/dsh-server/recovery/shared-vm-config-ohemmy10`; the original updater script is in `shared-vm-sync-sglzc29j` under the same recovery root.

After configuration activation, the main and companion services were active, the main loopback endpoint returned its expected unauthenticated HTTP 401, and the retained VM remained running. The main process used about 978 MiB at the observation, not a measured peak. The fresh browser also required authentication; a real Daedal-OpenAI UI turn remains unverified. No CI run was reported for the published branch at this observation.

A separate restart probe created 1,074,790,400 disk-backed bytes at `/workspace/harness-restart-XPqZTMqS/restart.bin` with `dd if=/dev/zero bs=1048576 count=1025 conv=fsync`, and started the unique guest unit `dsh-harness-restart-XPqZTMqS` with `systemd-run --collect --service-type=exec /bin/sleep 1800`. After the main-service configuration restart, SHA-256 remained `0e5784b2441347f7c1cbfe2ee03dd421ff87c3086fdf0ce280cf26cbcf114462`; both the probe unit and Docker were active. This proves that restart did not stop the independent guest service or lose the mounted file, not crash recovery or a physical-host reboot.

A second `sudo -n /usr/bin/systemctl restart --no-block dsh-web.service` exercised shutdown and startup of the shared composition itself. The main PID changed from 2906849 to 2907299; the file hash, probe service, and Docker checks passed again. Cleanup stopped only `dsh-harness-restart-XPqZTMqS`, removed its exact `restart.bin`, and removed the empty probe directory. No repository files or VM disks were removed.

Retained conversation directories `/home/carlo/.local/share/dsh-server/workspaces/cc76b316faf34bd79c27e9076af69673/workspace` (about 5.1 GiB) and `/home/carlo/.local/share/dsh-server/workspaces/ab90725a86f349d8a420a08277f511c2/workspace` (about 355 MiB) remain untouched after user-authorized reconciliation. CLM's uncommitted source files were copied to its recovered branch without dependency caches. Phoebe's committed history was fetched into its recovered branch. The host's original untracked `oom` file is preserved in `/home/carlo/.local/share/dsh-server/recovery/reconcile-clm-gveCh0qK`.

The recorded guest paths `/workspace/repos/ad80457c2edf8397` and `/workspace/repos/b8fc9576301029f7` are ordinary directory symlinks to the corresponding shared mounts. Guest `readlink -f` confirmed their destinations. They preserve historical command paths without recreating per-conversation Git handling. Historical Session events are retained; the migration does not rewrite old waiting or failure cards as successful saves.

Release builds use `/home/carlo/.local/share/dsh-server/deployment.git`, not the Git configuration in the guest-writable harness repository. Its independent linked release checkouts use worktree-specific configuration: `core.bare=true` is in the main repository's `config.worktree`, with `extensions.worktreeConfig=true` and repository format 1 in the common configuration. The initial dependency installation rejected shared `core.bare=true`; the documented Git migration resolved it without bypassing hook installation. `git rev-parse --git-common-dir` for release `8b58b45cf15e7c98035059d6a1ff4e5e60e68ff9` identifies the protected deployment repository.

The administrator-owned `zzzz-shared-workspace-launch.conf` drop-in sets `WorkingDirectory=/workspace`, an empty root-owned host directory. The activation helper uses the same directory for preflight. This host directory is distinct from the guest's disk-backed `/workspace` mount: the host launcher cannot load a repository-controlled `.env`, while new guest commands retain the `/workspace` coordinate. The original activation and synchronization scripts are preserved in `/home/carlo/.local/share/dsh-server/recovery/shared-control-plane-mkq6a774`. Guest checks confirmed the deployment repository, Harness home, and server environment file are absent from the VM.

The protected deployment completed successfully at revision `8b58b45cf15e7c98035059d6a1ff4e5e60e68ff9`, which differs from the runtime implementation commit only in this qualification record. Both isolated and live authenticated readiness checks passed with the shared-runtime patches selected. The main process PID was 2911015 after activation. The root-owned launch-directory drop-in survives future managed-release overrides; the updater timer remains disabled.
