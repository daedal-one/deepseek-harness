---
description: "Add a conversational Forge specification verification workflow to browser and headless Harness profiles."
kind: "package-bundle"
---

# @deepseek-ai/dsh-deadal-intellect

## Summary

Ask a coding assistant to verify implementation against Forge specifications, inspect evidence, and record qualified attestations. The `deadal-intellect` and `deadal-intellect-headless` profiles include this layer automatically. It supplies a dedicated agent preset and native verification integration while reusing the existing model settings and credentials. Compatible native Forge tools are required; the Forge application is optional.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

Launch `dsh --profile deadal-intellect` from the repository and follow the [verification guide](../../../docs/user/guide/deadal-intellect.md). For a one-shot session, select `deadal-intellect-headless` and supply the task as its positional argument. The same approval requirement applies on both surfaces.

The shipped templates stack base, the shared agent plane, the chosen browser or headless surface, and this layer. Its [patch document](cordis.patch.yml) is declared by the package manifest; it selects the default preset, supplies its discovery root and adds the host verification service. User profile patches still apply last. An existing saved preset preference can override the default; select Deadal-intellect explicitly in that case.

-----

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The preset belongs to this bundle, so ordinary profiles do not discover an agent whose host dependencies are absent. The native integration owns verification behavior; the bundle owns its profile composition and coding instructions. The main-agent route has a separate preset settings identity, while assessor and challenger settings are registered by the integration.

No invariant companion is published because this package contributes a static patch document and preset files, with no independently maintained runtime state.

</details>

-----

## Further Exploration

- [Verification guide](../../../docs/user/guide/deadal-intellect.md) — start and interpret a verification.
- [Native integration](../../integration/forge-intellect/README.md) — evidence and execution constraints.
- [Profile loading](../../boot/app-boot/README.md#profiles) — patch precedence and package resolution.

## Model Experience

### Verification persona

#### What the model sees

The selected preset supplies these instructions alongside the ordinary coding tools and native verification tools.

##### Preset instructions

```markdown
You are Deadal-intellect, a coding and implementation-verification assistant. Your workspace is {{cwd}}. Help the user test whether code meets its Forge specifications. Start verification requests with intellect_overview. Read the relevant specifications and source, then use intellect_prepare to propose a small meaningful set of checks with exact success markers. Explain the subject and checks in plain language. intellect_run presents the exact plan for approval and performs independent reviews in the background. Collect the background result with job_output (wait: true) and inspect it with intellect_result. Explain supported, contradicted, inconclusive, and stale separately. Offer concrete fixes for demonstrated gaps. After an approved verification succeeds, use intellect_attest to record it. Only report an attestation when that native operation succeeds. Never use manual spec implementation verify as a substitute for automated verification. Do not weaken requirements, edit evidence, invent success markers, or claim passing tests prove unrelated clauses. TASK progress and structural coverage are not adherence. When the checkout is dirty, help finish and commit the intended changes before planning; never discard changes or commit unrelated work. Use reassessment only for fresh reviews over current retained executions. Changed code needs a new run. Credentials belong in Settings, never in commands, plans, source context or chat.
```

#### Token effect

The fixed persona accompanies the main agent's requests. Repository instructions and tool results add context according to their owning plugins.

#### KV Cache effect

The persona stays stable within a workspace. A different workspace changes its directory interpolation; reviewer contexts are independent and owned by the native integration.

## Known Limitations and Deferred Work

- The profile uses compatible separately installed native Forge tools on macOS or Linux.
- Saved user settings and later profile patches take precedence over shipped defaults.
- A headless verification run needs an approval answerer. The browser provides the interactive approval flow.
- Verification runs are serial and execute only approved existing checks through native Intellect. Reviewers have no tools. New test code is authored before preparing another clean revision.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
