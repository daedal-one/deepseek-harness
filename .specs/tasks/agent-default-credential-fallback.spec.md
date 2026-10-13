---
id: TASK:llm/agent-default-credential-fallback
type: task
status: accepted
summary: Let the shipped default model route follow credential presence so a deployment holding only the first-party key starts on the DeepSeek adapter.
owners: [carlo]
progress: done
addresses: []
labels: [llm, configuration, defaults]
assignee: carlo
---

# Credential-aware default model route

## Acceptance

The agent-default-model plugin accepts a `credentialRef` naming the reference its primary route's adapter resolves plus ordered `fallbacks`, each carrying its own `{ provider, model, reasoningEffort?, credentialRef }`. Both halves are required together: a fallback list without `credentialRef`, and a `credentialRef` without a fallback, are rejected at plugin load, and a reference outside the credential seam's grammar is rejected by the config schema.

The main target's deployment route follows credential presence read through the credential seam: while the primary reference is unconfigured and a declared fallback's reference is configured, that fallback becomes the main route for Agent creation, the directory's reported provider and default, and settings validation. The first configured fallback in declaration order wins. Preset and named routes keep their composition provider, and a stored user selection is projected under whichever provider the main route currently names.

With no credentials service mounted, with an unread or failed presence read, or with neither declared reference resolving, the effective main route is byte-identical to the configured primary route, so keyless snapshots and existing tests stay unchanged, and a request without either key fails loud with `MISSING_CREDENTIAL` naming the primary reference.

## Verification

`packages/core/agent-default-model/tests` covers the primary route while its credential resolves, fallback selection by declaration order and by committed `credentials/reference-updated` changes, neither credential present, the fallback route as a savable and validatable target, keyless equivalence between an armed and an unarmed config, a failed presence read, and every malformed declaration. `pnpm exec vitest run packages/core/agent-default-model/tests` passes with 15 tests, oxlint is clean on the changed files, and `pnpm run verify-cordis-config` accepts the edited base rows. `spec lint` is unavailable in this environment because the forge-spec CLI is not installed; this spec is validated by inspection instead.
