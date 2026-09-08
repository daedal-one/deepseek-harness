# CLI contract: landlock-run

This file pins the launcher's externally observable behavior — the cross-repo compatibility surface between the binaries and every consumer. Consumers interact with it through the entry package (`launcherPath`/`probe`/`grantArgs`) and the launcher protocol; changing anything below requires a version bump for the whole package family and a note in the release notes.

## Invocation grammar

```text
landlock-run [--confidential] [--ro <path>]... [--rw <path>]... -- <argv>...
landlock-run --probe
landlock-run --probe-confidential
```

- `--ro <path>`: grant read + execute beneath `<path>`.
- `--rw <path>`: grant full filesystem access beneath `<path>` (every access the negotiated kernel ABI can govern).
- Everything not granted is denied — Landlock rulesets are allow-lists.
- A grant on a non-directory keeps only its file-compatible access bits (this is how a `--rw /dev/null` grant works).
- `--`: mandatory separator; everything after it is the command argv, exec'd via `execvp` with the launcher's environment unchanged.
- `--probe`: mutually exclusive with grants and a command.
- No other flags, no environment-variable inputs.

## Exit codes

- `125` (`LAUNCHER_FAILURE_EXIT`): every launcher-level failure — usage error, kernel that cannot enforce Landlock, unopenable grant root, failed `exec`. The wrapped command was NOT run.
- After a successful `exec`, every child status is passed through unchanged, including 125. Consumers therefore require both status 125 and a `landlock-run: ` fatal line to attribute launcher failure.
- `--probe`: `0` when the kernel enforces (fully or partially), `125` otherwise.

## Report lines

- Probe success prints exactly one stdout line: `landlock: fully enforced` or `landlock: partially enforced (older ABI)`. The entry package's `probe()` maps these to `full`/`partial`; a non-zero probe exit maps to `unusable`.
- A confined run under a partial-ABI kernel prints one stderr line `landlock-run: partial enforcement (older Landlock ABI)` and proceeds — still confined for everything the kernel supports.
- Every fatal error prints one stderr line prefixed `landlock-run: ` before exiting `125`.

## Confinement semantics

The launcher sets `no_new_privs`, installs the ruleset on itself, and `exec`s the command; the ruleset is inherited across `execve`, so every descendant process is equally confined. The ruleset governs the filesystem accesses of the kernel's negotiated Landlock ABI (up to ABI 5); accesses newer than the running ABI are not governed and are the difference between `full` and `partial`.

## Confidential mode (0.1.2)

`--confidential` requires Landlock ABI 3 or newer, covering file read/write, cross-directory references and truncate. It additionally installs a native-architecture seccomp filter denying `socket`, `connect`, `io_uring_setup`, `pidfd_getfd`, `ptrace`, and cross-process memory read/write. Foreign syscall architectures and x32 calls terminate the process. An unavailable required mechanism exits 125 before executing the command. Ordinary invocation and probe behavior remain unchanged.

`--probe-confidential` accepts no other arguments, functionally installs both policies, checks that socket creation fails with EPERM, and prints exactly `landlock: confidential filesystem and socket denial enforced` on success. Consumers use `probeConfidential()` and `grantArgs({ confidential: true, ... })` rather than interpreting flags or report lines themselves.

Callers must pass only pipes or ordinary files, never inherited network sockets. `socketpair` remains available for local descendant IPC, preserving normal compiler and process-launch behavior. No new TCP, UDP, filesystem Unix or abstract Unix endpoint can be created. Commands cannot reach the parent service over loopback. Existing connected descriptors are outside this launcher's promise and must not be supplied by a caller. Filesystem ABI 3–4 do not govern device ioctls; callers must not grant device trees (Forge grants only `/dev/null` and read access to `/dev/urandom` for Git entropy).

This profile combines [Landlock filesystem restrictions](https://docs.kernel.org/userspace-api/landlock.html) with an inherited [seccomp syscall filter](https://docs.kernel.org/userspace-api/seccomp_filter.html); it does not grant capabilities, change namespaces, or relax an enclosing seccomp policy.
