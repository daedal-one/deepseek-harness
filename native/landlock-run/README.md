# @deepseek-ai/node-addon-landlock-run

A [Landlock](https://landlock.io/) self-restrict-then-exec launcher for confining subprocesses on Linux, distributed as prebuilt per-platform npm packages plus a thin JS entry package that resolves the binary and speaks its CLI contract. Built for agent harnesses and other hosts that need to run untrusted commands under a filesystem allow-list without confining themselves.

The tool is **`landlock-run`** — a self-restrict-then-exec [Landlock](https://landlock.io/) launcher (C11 over the raw kernel UAPI, statically linked against musl). It installs a Landlock ruleset on itself and `exec`s the wrapped command; the ruleset is inherited across `execve`, so the command and every process it spawns run confined while the invoking process stays unrestricted. Fail-closed: if the kernel cannot enforce, it exits without running the command.

## Install

```sh
npm install @deepseek-ai/node-addon-landlock-run
```

Published packages use an entry package plus platform optional packages:

```text
@deepseek-ai/node-addon-landlock-run
@deepseek-ai/node-addon-landlock-run-linux-x64
@deepseek-ai/node-addon-landlock-run-linux-arm64
```

npm's `os`/`cpu` fields make installers fetch only the matching platform package. There is no install-time build fallback on purpose: on a host without a platform package the resolved path never exists, the probe reports `unusable`, and the consumer falls closed.

## Usage

```js
import { grantArgs, launcherPath, probe } from '@deepseek-ai/node-addon-landlock-run';

const launcher = launcherPath();
if (probe(launcher) !== 'unusable') {
  const argv = [launcher, ...grantArgs({ readOnly: ['/'], readWrite: ['/tmp/work'] }), '--', 'bash', '-c', command];
  // spawn argv with your process runner of choice
}
```

The public API is intentionally small:

- `launcherPath()`: absolute path of this host's launcher (existence deliberately unchecked — the probe is the availability signal).
- `probe(launcher?, { timeoutMs? })`: functional enforcement probe — `'full' | 'partial' | 'unusable'`.
- `grantArgs({ readOnly?, readWrite? })`: the launcher's grant argv; everything not granted is denied.
- `LAUNCHER_BIN` and `LAUNCHER_FAILURE_EXIT` (125): contract constants. A successfully exec'd child may also return 125, so consumers need the fatal diagnostic as well as the status to attribute launcher failure.

The full binary contract (argv grammar, exit codes, report lines) is pinned in [docs/cli-contract.md](docs/cli-contract.md).

## Support

linux-x64 and linux-arm64, kernel with Landlock enabled (5.13+; ABI level determines `full` vs `partial` enforcement — see [docs/support-matrix.md](docs/support-matrix.md)). Other platforms deliberately have no package: consumers run different confinement backends there.

## Development

```sh
corepack enable
pnpm install
pnpm build:ts        # entry packages → lib/
pnpm build:native    # this Linux architecture's binaries (apt-get install musl-tools)
pnpm test
```

Binaries are git-ignored and built natively per architecture — locally for your own machine, by CI's per-arch runners as the builders of record. Release flow: [docs/release.md](docs/release.md).

## Confidential command profile

Version 0.1.2 adds `probeConfidential()` and `grantArgs({ confidential: true, ... })` for callers that require Landlock ABI 3 filesystem rights and mandatory denial of new network endpoints. It blocks access to a parent service through TCP, UDP or Unix sockets while preserving local descendant IPC with `socketpair`. Pass only ordinary files or pipes to the launched process; never pass a connected socket. This opt-in profile does not change ordinary partial/full probing. See the [CLI contract](docs/cli-contract.md#confidential-mode-012) for the required guarantees and limitations.
