---
id: TASK:process/quickstart-and-profile-composition-page
type: task
status: accepted
summary: Publish a first-read quickstart and extend the generated composition page with every shipped profile's resolved layering.
owners: [carlo]
progress: done
addresses: []
labels: [process, docs, onboarding]
assignee: carlo
---

# Quickstart and per-profile composition page

## Acceptance

The generated [composition page](../../apps/cli/composition.md) keeps its existing base-composition section and adds one section per shipped profile (`web`, `headless`, `sdk`, `sdk-minimal`, `acp`) listing the profile's bundles in order, each bundle layer's rows with their resolved package and layer effect, and the per-session preset plane the agent plane installs, including the default preset's rows for the host rows the agent plane disables. `pnpm run gen-doc-graphs` produces the page from the actual bundle patches, the shipped profile templates, and the default agent preset, and `pnpm run verify-doc-graphs` accepts it.

The new [quickstart](../../docs/user/guide/quickstart.md) is a tutorial that takes a reader from prerequisites to a running Web GUI that answers one task, and states the shipped default route and its `OPENROUTER_API_KEY` resolution order, the first-party DeepSeek route's `DEEPSEEK_API_KEY`, the `MISSING_CREDENTIAL` failure, the built-frontend requirement, `--dump-config`, the `$DSH_HOME` state locations, and one whole-row patch example. The [docs/user index](../../docs/user/index.md) redirect target resolves to that file, and `pnpm run verify-doc-budgets`, `pnpm run verify-md-links`, `pnpm run verify-md-wrap`, and `pnpm run verify-doc-site-fragments` cover the changed documents.
