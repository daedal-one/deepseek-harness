# Agent Note: Quickstart and per-profile composition page

Status: implemented

## Problem

The composition truth a new user needs was split across the base bundle patch, three mode patches, the `standard` agent preset, the shipped profile templates in [`profile.ts`](../../../../packages/boot/app-boot/src/profile.ts), and two LLM adapter READMEs. The only generated overview, [apps/cli/composition.md](../../../../apps/cli/composition.md), rendered the base third alone, while [packages/bundle/base/README.md](../../../../packages/bundle/base/README.md) and [packages/bundle/README.md](../../../../packages/bundle/README.md) both promised "the exact plugin set each shipped profile uses". The documentation site's root redirect named `./guide/quickstart`, a relative path with no file in the repository, so the canonical first read was dead.

## Decision

The [composition page](../../../../apps/cli/composition.md) keeps its base-composition section and gains one section per shipped profile in the order `web`, `headless`, `sdk`, `sdk-minimal`, `acp`. Each section lists the profile's bundles in `dsh.profile.bundles` order, then one table per bundle layer whose rows carry the resolved package and the layer effect (`insert`, `override`, or `disable`), then the per-session preset plane for the two profiles that mount `@deepseek-ai/dsh-agent-plane`: the host rows that layer disables, each resolved to the package the default `standard` preset mounts for it, plus the preset's own rows with no host counterpart.

[`scripts/gen-doc-graphs.ts`](../../../../scripts/gen-doc-graphs.ts) parses each bundle `cordis.patch.yml`, the `PROFILE_TEMPLATES` block in [`profile.ts`](../../../../packages/boot/app-boot/src/profile.ts), and the default preset file, and fails loudly when the shipped profile set changes, a bundle patch or default preset file is missing, an inserted row has no package name, or an override or disable targets a row no earlier layer mounted. The page keeps its hybrid maintenance mode: the row lists and the profile bundles come from source, and no package expansion is curated.

The new [quickstart](../../../../docs/user/guide/quickstart.md) is the repository-side target of the [docs/user index](../../../../docs/user/index.md) redirect, whose `./guide/quickstart` target resolves once that file exists. It carries prerequisites, install and build, the credential story, the Web launch, workspace selection, one task, `--dump-config`, the `$DSH_HOME` state locations, and one whole-row profile patch example.

## Alternatives considered

**Render the base rows once and link them from each profile section.** A reader resolving one profile would have to assemble its tree from two pages, and the generated page is the only place where a profile's resolved layering exists; the repeated rows are the page's subject.

**Curate the profile-to-bundle map inside the generator.** The shipped `PROFILE_TEMPLATES` block is the authority for a profile's bundles, so a curated copy would drift silently; parsing it with a loud failure on set changes keeps one owner.

**Change the docs/user index redirect to `./guide/quickstart.md`.** The published site serves that URL as the route's raw-Markdown twin, so the redirect would leave the rendered guide; the existing target already resolves once the file exists.

**Publish the new quickstart through the documentation site in the same change.** [`website/docs.ts`](../../../../website/docs.ts) maps route `guide/quickstart.md` to `docs/user/guide/index.md`, so republishing the new page as that route needs a manifest edit outside this change.

## Verification

`pnpm run gen-doc-graphs` writes six graph docs and `pnpm run verify-doc-graphs` reports them up to date. `pnpm run verify-doc-budgets` passes, `pnpm run verify-md-wrap` reports no hard-wrapped prose paragraphs across 1,000 files, `pnpm run verify-doc-site-fragments` resolves 1,495 internal fragment references, and `pnpm run verify-public-repository-links` and `pnpm run verify-doc-refs` pass. `pnpm exec vitest run scripts/gen-doc-graphs.spec.ts` passes three tests, and `pnpm exec oxlint scripts/gen-doc-graphs.ts` reports no findings. `pnpm run verify-md-links` reports eight broken `docs/config-catalog.md` anchors from package READMEs, none of them in the changed files.

## Consequences

A reader reaches the resolved composition of any shipped profile from one generated page, and the profile templates, bundle patches, and default preset are its only sources. The quickstart is the first page a new reader follows, and the composition page is one link away from it. The site root still redirects to the "Use the Web UI" guide, because the route that guide owns is `guide/quickstart.md`; republishing the new quickstart as that route stays open until the site manifest changes.
