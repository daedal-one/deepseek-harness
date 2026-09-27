---
description: "The managed DSH_* shell environment for users and maintainers choosing, configuring, or extending the environment every model shell call runs with."
kind: "package-reference"
---

# @deepseek-ai/dsh-shell-env

## Summary

`dsh-shell-env` provides the explicit environment that every model shell call — bash or pwsh — runs with: trusted `DSH_*` facts and session-scoped stored credentials. Built-in facts include `DSH_HOME`, `DSH_SHELL=1`, and the agent's `DSH_SESSION_ID`. Plugin authors can register their own facts with declared keys, collected per execution and disposed with their plugin; duplicate ownership or undeclared runtime keys fail loudly instead of silently overwriting. The registry changes nothing else the model sees — the shell tools own their own schemas and prompts.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Load this plugin in any composition that mounts a model shell tool (`dsh-tool-bash` or `dsh-tool-pwsh`): each foreground or background shell call then runs with a freshly collected managed environment instead of whatever `DSH_*` values the process inherited.

### Supplying a credential to one experiment

Set `credentialGrants` to the stored reference and the exact root session ids whose Agents and in-process descendants may receive it. Values resolve through `ctx.credentials` for every call, so saving or rotating a key takes effect on the next command without restarting the Harness. Configuration contains only references and session ids:

```yaml
- id: shell-env
  config:
    credentialGrants:
      - ref: OPENROUTER_API_KEY
        sessionRoots: [session-af5bb76c-1a09-4545-a7b3-604cb120b1f8]
```

Store `OPENROUTER_API_KEY` through **Settings → Models** or another configured credential-provider path. A missing value fails an authorized shell call before process allocation and names only the reference. Unrelated sessions and commands without an Agent receive nothing. Descendants receive the grant only while their live parent-session lineage reaches the configured root. The selected command can read, print, or persist the value, so grant only credentials intended for that experiment.

### What every shell call receives

Every call receives `DSH_HOME` (the absolute Harness home), `DSH_SHELL=1`, and, for agent calls, `DSH_SESSION_ID` (the calling session's id).

### Adding your own environment facts

Other plugins contribute facts by registering a contributor with a stable name, the complete set of `DSH_*` keys it may return, a description per key, and a resolver that computes values for one execution:

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-shell-env'

export const inject = ['shellEnv']

export function apply(ctx: Context): void {
  ctx.shellEnv.register({
    name: 'deployment-region',
    variables: { DSH_DEPLOYMENT_REGION: { description: 'Current deployment region.' } },
    resolve: execution => execution.agent === undefined ? {} : { DSH_DEPLOYMENT_REGION: 'cn-north' },
  })
}
```

Contributors must declare every key they return; returning an undeclared or non-string value fails the call. Registration is disposed with the registering plugin, so hot-reloading a plugin removes its facts.

### Choosing the Harness home

The single config field picks the home directory exposed as `DSH_HOME`; the default resolution order is the `dshHome` config, then ambient `$DSH_HOME`, then `~/.dsh`.

| Field | Default | Meaning |
|---|---|---|
| `dshHome` | `$DSH_HOME`, then `~/.dsh` | Absolute Harness home exposed as `DSH_HOME` |
| `credentialGrants` | `[]` | Stored credential references paired with authorized root-session lineages |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-shell-env) is the exhaustive source for every accepted field and its JSDoc.

### What can go wrong

Two contributors declaring the same key, a contributor claiming a reserved built-in (`DSH_HOME`, `DSH_SHELL`, `DSH_SESSION_ID`), a malformed credential reference, an empty or repeated root list, or a duplicate credential grant fails loudly. A `DSH_*` key must be all-caps with underscores (for example `DSH_REGION`), and a missing description fails registration. A configured credential that cannot resolve fails each authorized shell call before a process starts.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the registry and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Trusted namespace, rebuilt per call.** The environment is a Harness-owned `DSH_*` namespace: the shell executor discards inherited `DSH_*` values and merges the registry's current snapshot for each execution, so nested harnesses and concurrent parent/child agents cannot leak stale identities, and `process.env` is never modified.
- **Session-scoped credentials, resolved per call.** The deployment names references and root sessions rather than values. The registry proves the calling Agent's live ancestry immediately before each command and passes applicable values through the trusted shell request; model arguments cannot add grants, references, or environment entries.
- **Declared ownership, loud conflicts.** Contributors declare their keys up front so duplicate ownership is detected before the first command; resolvers may only return declared keys.
- **Built-ins stay here.** `DSH_HOME`, `DSH_SHELL`, and `DSH_SESSION_ID` are reserved for the registry; contributors cannot claim them.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry, `ShellEnvRegistry` service, and the built-in facts |
| — | No runtime invariant companion is published; the environment registry validates ownership and collected values at each registration/collection; it publishes no independent snapshot that a companion could cross-check. |

### Collection

`collect(execution)` starts from the built-ins, adds the session id when the execution carries an agent, then merges each registered contributor's resolved values sorted by contributor name. The result is a frozen, key-sorted snapshot passed through `ShellExecRequest.dshEnv`. `resolveCredentials(execution)` independently proves a configured root occurs in the Agent's live session lineage and resolves applicable references into `ShellExecRequest.env`. `list()` enumerates declarations without running resolvers, so it exposes neither secret values nor grant metadata.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shell family to the executor seam and the generated catalogs.

- [shell package map](../README.md) — the bash capability family and its roles.
- [Bash executor subsystem](../../../docs/subsystems/shell.md) — the `ctx.shell` seam the tools execute through.
- [tool-bash](../tool-bash/README.md) — the bash tool that consumes this environment.
- [tool-pwsh](../tool-pwsh/README.md) — the pwsh tool that consumes this environment.
- [home paths package](../../util/home-paths/README.md) — how `DSH_HOME` is resolved.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-shell-env) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the shell tools (`dsh-tool-bash`, `dsh-tool-pwsh`), which expose managed `DSH_*` facts and make applicable session-scoped credentials available to the command. Credential names and values do not enter the tool schema, prompt, or rendered result unless the command prints them.

#### KV Cache effect

The managed environment never enters the request prefix, so it does not invalidate provider cache reuse; the shell tools' definitions and the current request envelope own any prefix change.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the registry is a poor fit or needs care. They are current package constraints, not a task backlog.

- **`list()` enumerates plugin-contributed variables only** — registry-owned built-ins (`DSH_HOME`, `DSH_SHELL`, `DSH_SESSION_ID`) are not included, so diagnostics, prompt, or UI code must not treat `list()` as an exhaustive environment catalog.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
