# Agent Note: An opt-in policy bundle and a mounted-by-default marker in the config catalog

Status: implemented

## Problem

Two capability seams were configurable surfaces with no shipped owner. The tool-policy family (`packages/guard/tool-policy{,-enforcer,-shell,-mcp}`) and `packages/llm/model-routing` each publish a Schemastery `Config`, so [`docs/config-catalog.md`](../../../../docs/config-catalog.md) documented their rows as deployment-settable, yet no bundle in `packages/bundle/` and no profile in [`PROFILE_TEMPLATES`](../../../../packages/boot/app-boot/src/profile.ts) mounted any of them. The catalog therefore presented an ownerless surface as a deployment choice, against the rule that every abstraction and option is tied to a current owner and need.

The page also could not answer the question its own sections raise: for a given package, does any shipped profile mount it, and if not, which bundle declares its row? A reader had to diff bundle patches by hand, and `@deepseek-ai/dsh-base` appeared under "Library packages (no plugin entry)" even though the loader composes the rows it carries.

## Decision

A new opt-in bundle, `packages/bundle/policy` (`@deepseek-ai/dsh-policy`), follows the `dsh-base` shape: `dsh.bundle.patch` names `cordis.patch.yml`, `src/index.ts` exports nothing, and the patch is one `insert` list. The bundle mounts the decision service `tool-policy` and declares the other three rows `disabled: true`. A disabled row never loads, so adding the bundle enforces nothing on its own, but the row is declared, resolvable from the bundle's own dependency surface, and addressable by id for the profile patch that enables it.

The rows that stay disabled do so for reasons the schemas state. The enforcer needs at least one registered provider: with none, evaluation throws, the enforcer converts that into an `ask`, and below the threshold every agent tool call becomes a deferred denial. The shell provider needs deployment-owned tool mappings and three auxiliary `ctx.llm` review routes, and a route matching the acting model is excluded at runtime while missing evidence fails closed, so no generic route works. The MCP provider refuses an empty rule set, and each rule names one exact public `mcp__...` tool with its verdict, risk, categories, principals, URL arguments, and forbidden arguments. `docs/reference/daedal/host/cordis.patch.yml` remains the in-tree example of all four rows enabled with a deployment's own values.

`model-routing` is not mounted. It injects `modelCatalog`, which has no shipped provider, and no runtime code calls `ctx.modelRouting`, so mounting the service would repeat the ownerless-surface problem rather than solve it. Its README now states that no shipped bundle mounts it and that no production consumer is wired.

The [generator](../../../../scripts/gen-config-catalog.ts) derives one line per package from the composition graph instead of from a hand-kept list: the `PROFILE_TEMPLATES` bundle lists, each bundle's patch rows and id-targeted entries composed in order, and the preset trees a mounted `@deepseek-ai/dsh-agent-presets` contributes per session. A row the composition leaves disabled is not counted, an expression-gated row counts as mounted because the expression decides per host, and a patch carrier whose entry exports no plugin reports the profiles that list it. The page gained a "Profile bundles" section for those carriers, so "a `cordis.yml` cannot load them" is no longer said of a package whose substance is a patch list.

## Alternatives considered

**Move the tool-policy packages to `experimental/`.** The group is the repository's home for pre-stable work without a shipped owner, so it would have removed the catalog entries from the harness tier and satisfied the ownership rule by relocation. It lost because these packages are not prototypes: they are complete, covered by focused and loader-composition tests, and the mechanism is current — the enforcer is a real consumer of the decision service, the shell provider has a documented independent-evidence contract, and a deployment mounts all four today. Hiding them would have left the seam concept the repository documents in `docs/capability-seams.md` with no shipped way to compose it. A mountable bundle keeps the packages in place and gives the family an explicit opt-in owner in the same graph the catalog reads.

**Mount the whole stack live with conservative defaults.** This would have made `dsh plugin --profile <name> add @deepseek-ai/dsh-policy` enforce authorization immediately. It lost because no generic default exists: a reviewer route equal to the acting model is excluded and fails closed, an empty MCP rule set is refused at activation, and a provider-less enforcer denies every agent tool call. Shipping that default would trade an ownerless surface for a broken one.

**Comment the provider rows out instead of declaring them disabled.** Commented rows are invisible to the composed tree, to the dependency-resolution check that anchors on the bundle directory, to `dsh --dump-config`, and to the catalog marker this change adds — which would have left the family looking ownerless in the document the change exists to fix. A disabled row states the same thing while staying resolvable and addressable.

**Mount `model-routing` beside the policy rows.** It would have given both seams the same treatment and one place to look. It lost for the reason above: a service whose only injected provider is absent and whose methods no code calls has no current need, so the truthful catalog line is the one recording that no shipped composition reaches it.

**Keep the existing package classification and add only the marker line.** The marker alone would have left `@deepseek-ai/dsh-base` and the other patch carriers under the library heading, which claims a `cordis.yml` cannot load them. The added "Profile bundles" section costs one filter and one heading, and it makes the classification agree with the manifest.

## Consequences

The config catalog answers, for every catalogued package, where its rows come from: a mounted profile set, the shipped bundles that declare an opt-in row, or nothing. Every section and list entry carries the line, so the generated page's diff is large but mechanical, and `pnpm run verify-config-catalog` keeps it fresh.

The tool-policy family now has a shipped owner: the decision service mounts when the bundle is added, and the enforcement and provider rows wait for the deployment's routes and rules. The bundle's README carries the audited short Model Experience sentence, like `dsh-base`'s, because the bundle owns no prompt, schema, or model-visible content itself.

`model-routing` is documented as unowned rather than hidden: a future provider or consumer change mounts it together with the consumer that makes it necessary, and the marker then moves on its own. Verification for this change is the bundle spec (manifest declaration, single active row, disabled provider rows, dependency resolution, and the enforcer row config resolving through the package's own schema while both provider schemas reject an empty config), the regenerated catalog and its freshness check, and the README marking in the four tool-policy packages and `model-routing`.
