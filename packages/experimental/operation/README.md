---
description: "Private opt-in sequential operation plans that dispatch existing tools through bounded semantic checkpoints and durable replay records."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-operation

## Summary

`dsh-experimental-operation` adds the opt-in `run_operation` tool to a composition that explicitly mounts it.

It parses a version-one JSON plan, admits fixed visible tools, resolves only typed JSON-pointer references, dispatches one nested tool at a time, records canonical evidence, and asks one configured closed-set judgment provider whether to continue, stop, replan, or complete.

The package is private and experimental.

## Use this package

Mount this service beside `dsh-tools`, durable Session persistence, and a provider package such as `@deepseek-ai/dsh-experimental-operation-clm`.

```yaml
- name: '@deepseek-ai/dsh-experimental-operation'
- name: '@deepseek-ai/dsh-experimental-operation-clm'
  config:
    endpoint: https://clm.example.invalid/v1/systemone
    tokenizerId: qwen3-8b
    model: clm-v0.1-8b
    encoder: qwen3-8b@sha256:replace-me
    deployment: sha256:replace-me
    deploymentManifest:
      reference: registry.example.invalid/clm-deployments/production.json
      digest: sha256:replace-me
    calibrationId: dike-heldout-v1
    temperature: 1
```

The composing deployment registers the exact tokenizer hook named by `tokenizerId` before mounting the CLM provider.

`run_operation` accepts a finite version-one plan with named JSON inputs, nonempty fixed steps, deterministic assertions, explicit observations, and final completion evidence.

Every planned tool is admitted against the calling agent's current scoped visibility and deferred discovery state before the first dispatch, then rechecked before every effect.

## Model Experience

### Model input

The model sees `run_operation` only when this package is mounted.

Its input is a JSON plan, never executable code or shell interpolation.

### Token and KV-cache effects

The operation runner does not append checkpoint data to the planning model context.

The judgment provider receives only the bounded canonical observation and complete candidate actions recorded for that checkpoint.

Each provider input is separately tokenized through the configured exact tokenizer hook; the runner rejects inputs beyond the frozen budget instead of truncating them.

## Durable records and replay

The package writes log-only `operation/*` events for admission, step intent and canonical results, judgment requests and responses, transitions, and terminal outcomes.

It flushes the judgment request before provider inference and flushes a selected transition with the next step intent before that next tool dispatch.

`replayOperation()` reconstructs the selected run from those records without calling tools, models, or the filesystem.

A started step without a recorded result remains `unknown` on replay; no operation is automatically resumed.

## Known Limitations and Deferred Work

- Plans are strictly finite and sequential: no retries, branches, DAGs, background work, nested operation runs, compensation, or restart continuation.
- The initial evidence surface is complete JSON Pointer values and arrays of complete JSON candidate records; it does not parse arbitrary stdout, CSV, or command text.
- Shell tools are accepted only with fully literal arguments; interactive terminals and composition/delegation tools are excluded.
- A passing declared completion check is evidence for the plan only, not independent proof of an arbitrary natural-language goal.
- The package is not mounted by shipped profiles, has no Operations mode or UI, and does not establish CLM quality or live-provider performance evidence.
