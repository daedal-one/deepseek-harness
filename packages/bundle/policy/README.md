---
description: "The opt-in tool-authorization layer for a base-backed dsh --profile surface: the tool-policy decision service plus the enforcement and provider rows a deployment enables with its own routes and rules."
kind: "package-bundle"
---

# @deepseek-ai/dsh-policy

## Summary

This is the opt-in layer that turns on tool authorization. No shipped profile lists it, so it changes nothing until a deployment adds it, and adding it mounts only the `ctx.toolPolicy` decision service. The enforcement consumer and the two providers ship as declared, disabled rows: a deployment enables them in its profile patch and supplies the auxiliary model routes or exact tool rules each one requires. Use it when a profile must decide what the agent may execute before it executes, rather than only reacting to a sandbox denial.

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

### Install into a profile

From a repository checkout, add the source bundle to a selected base-backed profile:

```text
pnpm dsh plugin --profile <name> add link:./packages/bundle/policy
pnpm dsh plugin --profile <name> remove @deepseek-ai/dsh-policy
```

The add operation runs the profile's package manager and appends the layer to `dsh.profile.bundles`, so the patch composes after `dsh-base` and after the surface bundle on the next launch. Unlike the core and surface bundles an installed `dsh` already carries, this layer is added per profile; a published release is added by its package name instead of the source link. The profile contract is documented in the [app-boot profile section](../../boot/app-boot/README.md).

### What you get

The `ctx.toolPolicy` service: the provider-neutral registry every policy provider registers against and the enforcement consumer asks for a verdict. Nothing is enforced by adding the bundle alone — the enforcement row and both provider rows are declared `disabled: true` so a profile never inherits an authorization stack whose reviewers, routes, and rules this package cannot know.

Enabling means editing the profile's `cordis.patch.yml`: a patch entry addressed at the row id replaces that row's whole config, so an enabling layer restates every key it wants and sets `disabled: false`. This minimal composition authorizes one reviewed MCP tool with no model route at all:

```yaml
- id: tool-policy-mcp
  name: '@deepseek-ai/dsh-tool-policy-mcp'
  disabled: false
  config:
    id: mcp
    rules:
      - tool: mcp__context7__resolve-library-id
        decision: allow
        risk: 5
        categories: [read-only, documentation]
        reason: Context7 library resolution is read-only
        urlArguments: []
        forbiddenArguments: []

- id: tool-policy-enforcer
  name: '@deepseek-ai/dsh-tool-policy-enforcer'
  disabled: false
  config:
    approvalThreshold: 3
```

The three rows differ in what they need:

- **`tool-policy-enforcer`** applies verdicts on `tools/pre-execute` and needs at least one registered provider. Enable it together with a provider row; configured alone it fails closed, which denies every agent tool call until the approval threshold is reached.
- **`tool-policy-shell`** reviews shell commands against user intent and deployment rules. It needs the deployment's explicit tool mappings and three auxiliary `ctx.llm` review routes (intent, primary effect, and an independent secondary effect route); a route that matches the acting model is excluded at runtime and missing independent evidence fails closed. Its [package README](../../guard/tool-policy-shell/README.md) owns every bound and deterministic rule form.
- **`tool-policy-mcp`** applies deterministic rules to an exact reviewed MCP tool surface. Activation refuses an empty rule set, so it needs one rule per public `mcp__...` tool name, with its verdict, risk, categories, and optional principals and argument restrictions; its [package README](../../guard/tool-policy-mcp/README.md) owns the rule contract.

Every deployment-varied value stays in the profile patch, so the same bundle serves a permissive deployment and a fail-closed one.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle is a static patch document: one `insert` list applied over the rows the earlier layers already contributed. Its own module mounts nothing, emits no events, and holds no mutable state; each declared row's package owns that row's behavior, configuration, and invariants.

### Row states

`tool-policy` is the only active row, because the decision service must exist before any provider can register. The other three rows carry `disabled: true`: the loader skips a disabled row entirely, so its package is never imported, its config schema is never validated, and the row stays addressable by id for a later patch layer, which is what makes the declared config surface visible without mounting it. `tool-policy-shell` and `tool-policy-mcp` carry no `config` at all: every required value in both schemas is deployment-owned, so an enabling patch must restate the complete block. The enforcer's single key is restated from the package default so the profile's effective chain length is visible.

### Composition mechanics

A patch replaces the targeted row's whole `config` rather than merging into it, and later layers win per row, so at most one layer plus the deployment's own states a row's values. The bundle declares the four policy packages as dependencies even though three rows ship disabled: per-layer resolution anchors on the bundle package directory, so the declared rows resolve from this bundle's own dependency surface, and enabling a row needs no further install.

### Source map

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The bundle substance: the decision-service row plus the declared, disabled enforcement and provider rows, with per-row rationale as inline comments |
| [`src/index.ts`](src/index.ts) | Package entry; carries no runtime API |
| — | No runtime invariant companion is published; the package is a static patch-list carrier (a YAML document of loader rows owned by other packages); it mounts no service, emits no events, and owns no mutable relation to check. Each declared row's own package carries that row's invariants. |
| [`tests/policy.spec.ts`](tests/policy.spec.ts) | Manifest declaration, row-declaration, dependency-resolution, and row-config schema checks |

### Invariant ownership

No invariant companion is published because the package is a static patch-list carrier: each declared row's package owns that row's invariants, and the bundle owns no mutable relation to check.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when you want to go deeper into the authorization service, the deployment contract of each row, or the profiles this layer is added to.

- [The tool-policy decision service](../../guard/tool-policy/README.md) — the registry, its verdicts, and the durable audit events.
- [The enforcement consumer](../../guard/tool-policy-enforcer/README.md) — the execution gate, the approval threshold, and the runtime context it contributes.
- [Bundle package map](../README.md) — the other profile layers.
- [The opt-in policy bundle decision](../../../.agents/notes/implemented/feature/2026-10-09-opt-in-policy-bundle-and-catalog-mounted-marker.md) — why the stack ships declared and disabled, and how the catalog marker is derived.
- [app-boot profile section](../../boot/app-boot/README.md) — how profiles are resolved, layered, and customized.
- [Generated config catalog](../../../docs/config-catalog.md) — every row's config declaration and the shipped profile that mounts it by default.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the declared rows' packages, which own their model-facing behavior; this layer contributes none of its own.

#### KV Cache effect

The bundle itself adds no request prefix; each declared row's package owns any cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits tell you what adding this layer does and does not do, and what each enabling patch must supply.

- **Adding the bundle enforces nothing by itself** — only the decision service mounts; the enforcement row and both providers stay disabled until the profile patch enables them, so an installation that forgets the second step silently authorizes every tool call as before.
- **The enforcement row needs a registered provider** — a live enforcer with no provider receives an unavailable policy, which becomes an `ask`; below the threshold that is a deferred denial of every agent tool call, so enable the enforcer and a provider together.
- **Both provider rows need deployment-owned configuration** — the shell provider needs explicit tool mappings and three auxiliary model routes, and the MCP provider needs at least one exact `mcp__...` rule; neither has a generic default, and enabling either without its config fails loud at load.
- **No shipped profile lists this layer** — the generated config catalog marks each row in this family as opted in through this bundle rather than mounted by a shipped profile, and the layer is composed only for profiles that add it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
