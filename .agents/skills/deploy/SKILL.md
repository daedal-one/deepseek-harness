---
name: deploy
description: Use when the user types /deploy or asks to deploy, ship, rebuild, restart, or make the current DeepSeek Harness changes visible in the running Web GUI, because the rebuild, restart, and URL verification must happen in a host session rather than the isolated agent workspace.
---

# Deploy DeepSeek Harness changes

"Deploy" means: rebuild the artifacts the running harness serves, reload the harness so it serves them, and verify the exact URL the user is looking at. It does not mean publishing packages, tagging a release, or pushing a branch unless the user says so.

## Why this goes to the host

The agent workspace is isolated: its paths, processes, and localhost do not identify the machine running the harness. Builds of the served checkout, the reload or restart, and any check against `http://127.0.0.1:3080` therefore belong to a host session. Never start a replacement server in the agent workspace, and never report the change as deployed from there.

## Procedure

1. Establish the deployment scope in the current checkout.

```sh
git status --short
git rev-parse --show-toplevel
git log --oneline -3
```

Separate the user's change from unrelated in-flight edits in the same tree. Deploy the working tree as it stands; do not commit unrelated files, and commit nothing at all unless the user asked for a commit. If the user asked for one, stage only the deployment scope and follow the repository's own commit and quality-gate rules.

2. Report which surfaces the scope touches, because that decides what must be rebuilt:

- Host packages (`packages/*/*/src` outside `packages/client/`): `pnpm run build:lib:host`.
- Client plugin packages (`packages/client/*`): `pnpm run build:lib:client`; a plugin-only change may already hot-reload while `pnpm run dev:web` is running, so check for that watcher before promising a refresh.
- The Web shell (`apps/web`): `pnpm run build:web`.
- An installed release checkout may need `pnpm run build` instead; use the checkout the running harness actually serves.

3. Hand off. Discover the configured targets by calling `handoff_to_host` with no target, then call it again with the chosen target identifier to request the user's confirmation for a new host session.

4. The handoff task must carry, in full: the checkout path, the exact build commands for the surfaces in scope, the reload or restart step, the URL to verify, what a correct result looks like on that URL, every check already run in the agent session with its result, and the remaining host steps. Exclude secrets; carry no credentials.

5. Report the outcome as the destination session's outcome. State the URL and what was rebuilt; never claim the GUI renders the change until that session verified it.

## Notes

- Rebuild before reloading: a restart with stale `lib/` artifacts serves the old behavior.
- A build that fails on unrelated in-flight work is a real blocker to name, not something to work around by deploying a partial artifact set.
- If the skill itself is missing from the host's slash menu after a deploy, verify the file exists at the host's DSH_HOME skills root (`$DSH_HOME/skills/deploy/SKILL.md`, default `~/.dsh/skills/deploy/SKILL.md`).
