---
description: "Private CLM System One HTTP ranking adapter for experimental operation checkpoints, with strict wire checks and exact configured tokenizer accounting."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-operation-clm

## Summary

`dsh-experimental-operation-clm` lets an operation rank its supplied complete actions through one configured CLM System One endpoint. The adapter checks the exact request encoding, response distribution, token ceiling, and locally pinned deployment identity before accepting a ranking. It cannot generate plans, dispatch tools, invoke approvals, change candidates, or switch models. The package is private and experimental; deterministic protocol evidence does not establish live model quality.

## Table of Contents

- [Use this package](#use-this-package)
- [Protocol and validation](#protocol-and-validation)
- [Lifecycle](#lifecycle)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

Mount [operation](../operation/README.md) first, register a tokenizer hook with the same `tokenizerId`, then mount this plugin. This example illustrates required deployment fields, not a tested public endpoint or default encoder ceiling.

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
    maxEncoderTokens: 2048
    credentialRef: CLM_API_KEY
```

`endpoint`, `tokenizerId`, `model`, `encoder`, `deployment`, `temperature`, and `maxEncoderTokens` are required. The tokenizer must match the deployed encoder, including its special tokens, and `maxEncoderTokens` must equal the reviewed server ceiling. The [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-operation-clm) owns the complete configuration and resolved defaults.

`deploymentManifest` records the operator's explicit local verification of the immutable serving deployment. CLM does not echo an immutable deployment identity, so a response model name cannot verify the deployment. Autonomous operation execution requires this local verification and, when the runner's calibration policy is enabled, a calibration identity.

`credentialRef` is optional. When configured, the adapter resolves it through `ctx.credentials` for every HTTP request and sends the value only as a bearer authorization header.

## Protocol and validation

The adapter sends exactly one `POST /v1/systemone` request with `{state, model, temperature, questions:{transition:{type:'choice',instructions,criteria}}}`. It rejects non-local HTTP endpoints, endpoints other than `/v1/systemone`, non-200 status, bodies larger than `maxResponseBytes`, missing `application/json`, incomplete JSON, model mismatch, malformed answers, unknown choice keys, incomplete probability coverage, and invalid distributions.

The upstream wire has no request ID, encoder, deployment, truncation, or identity field. Transport completeness depends on the exact status, bounded complete body, and complete JSON parse rather than an invented response field.

The response must contain `{model,answers:{transition:{type:'choice',choice,confidence,probabilities}},usage:{billing_units,input_tokens,output_tokens}}`. Its choice must name a highest-probability supplied candidate. This single-question request requires `billing_units: 1` and `output_tokens: 0`, as emitted by [the pinned server](https://github.com/Contrastive-LM/CLM/blob/bb42c6c5bf914fd449bed2f6ca65be80602cb1f7/src/clm/engine.py).

Preparation retains every exact encoder text and its local token count in `encoding.inputs`, together with the reviewed `encoding.maxTokensPerText` ceiling. The operation runner records that evidence and the outbound `wire` before inference. A successful result retains the complete parsed response in `wire`, including the selected choice, confidence, distribution, and original usage fields, alongside the normalized response and locally associated request identity. These records preserve JSON facts, not the response body's whitespace.

## Lifecycle

Each HTTP request fuses the caller cancellation signal with the configured deadline. Provider disposal aborts every owned tokenizer preparation and HTTP request and waits for all of them to settle before disposal completes. The adapter never retries failed requests or falls back to a different model or endpoint.

## Further Exploration

- [Operation runner](../operation/README.md) — admission, recording barriers, and replay ownership.
- [Wire implementation](src/wire.ts) — pinned encoder rendering and response validation.
- [Provider tests](tests/provider.spec.ts) — deterministic transport and token-accounting evidence.

## Model Experience

### System One ranking input

#### What the model sees

The CLM provider receives one canonical operation state and the runner's complete candidate actions through a closed `transition` choice request. The planning model does not see this adapter directly; the operation runner owns its tool result.

#### Token effect

The exact tokenizer counts the upstream-rendered state plus two newlines plus instructions, then each candidate description separately. Rendering follows canonical wire key order and JSON numeric spellings, not draft insertion order; counts include deployed encoder special tokens, not JSON syntax or request markup. Any text above `maxEncoderTokens` rejects locally instead of allowing upstream truncation. The runner budgets the local total, while cache-dependent `usage.input_tokens` remains separate provider usage.

#### KV Cache effect

The adapter shares no prompt text or KV cache with the planning model. Provider caching can change reported input usage but does not change the local admission count or reviewed per-text ceiling.

## Known Limitations and Deferred Work

Deployment verification and model-quality evidence remain separate from protocol acceptance.

- The adapter has no bundled tokenizer; a deployment must register an exact tokenizer hook for its configured encoder before mounting it.
- Local manifest verification records an operator-reviewed immutable deployment; it cannot attest to a remote server beyond that deployment control plane.
- The protocol is a narrow `transition` choice wire, not a general chat-completions or generation API.
- The [supported-profile keyless scenario](../../../snapshots/sdk/clm-operations/snapshot.yml) uses a deterministic judgment provider, not this HTTP adapter. No live provider smoke is recorded for this package; deterministic protocol tests do not establish model quality, calibration quality, or paid Dike evaluation evidence.
- The package is private, experimental, and absent from shipped default profile composition.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published because request preparation and response parsing validate the provider's owned facts before returning them, and disposal drains its owned requests. The package maintains no separate live projection or independently observed state for a `./invariant` entry to compare.

</details>
