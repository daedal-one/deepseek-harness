---
description: "Private CLM System One HTTP ranking adapter for experimental operation checkpoints, with strict wire checks and exact configured tokenizer accounting."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-operation-clm

## Summary

`dsh-experimental-operation-clm` supplies one private HTTP provider for the operation judgment seam.

It can rank only the complete candidate set supplied by `dsh-experimental-operation`.

It cannot generate plans, dispatch tools, invoke approvals, change candidates, or switch models.

## Use this package

Mount `@deepseek-ai/dsh-experimental-operation` first, register a tokenizer hook with the same `tokenizerId`, then mount this plugin.

```yaml
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
    credentialRef: CLM_API_KEY
```

`endpoint`, `tokenizerId`, `model`, `encoder`, `deployment`, and `temperature` are required identity and request facts.

`deploymentManifest` is the operator's explicit local verification record for the immutable serving deployment.

A run records that configuration locally; CLM does not echo an immutable deployment identity, so a response model name cannot verify the deployment.

Autonomous operation execution requires this manifest verification and calibration identity.

`credentialRef` is optional.

When configured, the adapter resolves it through `ctx.credentials` for every HTTP request and sends it only as a bearer authorization header.

`providerId`, `serialization`, `timeoutMs`, and `maxResponseBytes` are resolved configuration fields.

## Protocol and validation

The adapter sends exactly one `POST /v1/systemone` request with `{state, model, temperature, questions:{transition:{type:'choice',instructions,criteria}}}`.

It rejects non-local HTTP endpoints, endpoints other than `/v1/systemone`, non-200 status, response bodies larger than `maxResponseBytes`, missing `application/json`, incomplete JSON, model mismatch, malformed answers, unknown choice keys, incomplete probability coverage, and invalid distributions.

There is no request ID, encoder, deployment, truncation, or identity field on this upstream wire.

Transport completeness is established by the exact status, bounded complete body, and complete JSON parse rather than by an invented response field.

The response must contain `{model,answers:{transition:{type:'choice',choice,confidence,probabilities}},usage:{billing_units,input_tokens,output_tokens}}`.

## Model Experience

### Model input

The planning model does not see this adapter directly.

The provider receives a closed System One choice request containing one canonical operation state and the runner's complete candidate actions.

### Token and KV-cache effects

Before HTTP dispatch, the adapter counts the texts the CLM encoders actually receive through the configured exact tokenizer hook: the upstream-rendered state plus two newlines plus instructions, then each candidate description separately.

It never tokenizes JSON syntax or request markup.

The locally counted total is recorded and budgeted by the operation runner.

The upstream `usage.input_tokens` count is cache-dependent and is retained as provider usage, not compared to the local count.

No prompt text or KV cache is shared with the planning model.

## Lifecycle

Each request fuses the caller cancellation signal with the configured deadline.

Provider disposal aborts every owned HTTP request and waits for all of them to settle before unregistering completes.

The adapter never retries failed requests or falls back to a different model or endpoint.

## Known Limitations and Deferred Work

- The adapter has no bundled tokenizer; a deployment must register an exact tokenizer hook for its configured encoder before mounting it.
- Local manifest verification records an operator-reviewed immutable deployment; it cannot attest to a remote server beyond that deployment control plane.
- The protocol is a narrow `transition` choice wire, not a general chat-completions or generation API.
- No live provider smoke has been run by this package; deterministic protocol tests do not establish model quality, calibration quality, or paid Dike evaluation evidence.
- The package is private, experimental, and absent from shipped profile composition.
