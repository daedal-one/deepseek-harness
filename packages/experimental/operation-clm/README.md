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
    tokenizerId: qwen3-8b@sha256:replace-me
    model: clm-v0.1-8b
    encoder: qwen3-8b@sha256:replace-me
    deployment: sha256:replace-me
    deploymentManifest:
      reference: registry.example.invalid/clm-deployments/production.json
      digest: sha256:replace-me
    temperature: 1
    maxEncoderTokens: 2048
    credentialRef: CLM_API_KEY
```

`endpoint`, `tokenizerId`, `model`, `encoder`, `deployment`, `temperature`, and `maxEncoderTokens` are required. The tokenizer must match the deployed encoder, including its special tokens, and `maxEncoderTokens` must equal the reviewed server ceiling. The [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-operation-clm) owns the complete configuration and resolved defaults.

`deploymentManifest` records the operator's explicit local verification of the immutable serving deployment. CLM does not echo an immutable deployment identity, so a response model name cannot verify the deployment. Autonomous operation execution requires this local verification and, when the runner's calibration policy is enabled, a calibration identity. The example omits `calibrationId`: supply only an operator-reviewed real calibration artifact identity, never an invented value to bypass admission. Tokenizer availability and deterministic protocol tests do not qualify a model.

`credentialRef` is optional. When configured, the adapter resolves it through `ctx.credentials` for every HTTP request and sends the value only as a bearer authorization header. Credentials embedded in endpoint URLs reject at load. Invalid credential header values reject locally without including the secret in an error message.

The provider snapshots its resolved configuration for its lifetime and records a `configurationDigest` over the endpoint, credential reference, pinned protocol, model and encoding identities, deployment/calibration declarations, temperature, and token/body/deadline limits. Credential values are excluded; rotating a secret under the same reference does not change the configuration identity. The reference is hashed, not exposed in the provider identity. A prepared request from a different configuration rejects before transport, even when its model name matches.

### Local tokenizer hook

Mount the credentials provider and [operation](../operation/README.md) service first, this named `./tokenizer` plugin second, and the CLM provider last. The hook sends exact texts to a separately provisioned local tokenizer service; it does not load models or tokenizer artifacts in DSH. These example limits are explicit operator choices, not defaults or a deployment qualification.

```yaml
- name: '@deepseek-ai/dsh-experimental-operation-clm/tokenizer'
  config:
    endpoint: http://127.0.0.1:8765
    credentialRef: LOCAL_DECISION_API_KEY
    tokenizerId: qwen3-8b@sha256:replace-me
    timeoutMs: 5000
    maxRequestBytes: 262144
    maxResponseBytes: 16384
    maxConcurrentRequests: 2
    maxTexts: 17
    maxTokensPerText: 2048
```

Every field shown is required. `endpoint` must be a loopback HTTP origin without credentials, a route, a query, or a fragment. The credential reference resolves for each request through the required credentials service; only the bearer header carries its value. Pin `tokenizerId` to the deployed tokenizer and special-token recipe, use that same identity in CLM, and set `maxTokensPerText` to the reviewed encoder ceiling. `maxTexts` must accommodate the state/instructions text plus every independently encoded candidate description.

The hook posts `{version:1,tokenizer:tokenizerId,texts}` to `/v1/tokenize` and requires `{version:1,tokenizer,counts:[{index,textDigest,tokens}]}` with no extra or missing fields. Each entry must occupy its original index, match the SHA-256 digest of the exact UTF-8 text (`sha256:` plus lowercase hexadecimal), and contain a non-negative safe integer no greater than `maxTokensPerText`. Empty batches, missing counts, reordered indices, mismatched digests, and invalid counts reject; empty strings remain valid texts. The shared [local transport](src/local-http.ts) bounds the complete serialized request and response, rejects excess concurrent admission, and cancels on deadline or disposal without retrying.

## Protocol and validation

The adapter sends exactly one `POST /v1/systemone` request with `{state, model, temperature, questions:{transition:{type:'choice',instructions,criteria}}}`. It rejects non-local HTTP endpoints, endpoints other than `/v1/systemone`, non-200 status, bodies larger than `maxResponseBytes`, missing `application/json`, incomplete JSON, model mismatch, malformed answers, unknown choice keys, incomplete probability coverage, and invalid distributions.

The serialization identity is fixed to `clm-systemone-bb42c6c5`; other configured recipes reject because this adapter does not implement them. The upstream wire has no request ID, encoder, deployment, truncation, or identity field. Transport completeness depends on the exact status, bounded complete body, and complete JSON parse rather than an invented response field.

The response must contain `{model,answers:{transition:{type:'choice',choice,confidence,probabilities}},usage:{billing_units,input_tokens,output_tokens}}`. Its choice must name a highest-probability supplied candidate. This single-question request requires `billing_units: 1` and `output_tokens: 0`, as emitted by [the pinned server](https://github.com/Contrastive-LM/CLM/blob/bb42c6c5bf914fd449bed2f6ca65be80602cb1f7/src/clm/engine.py).

Preparation prefers one `countMany` call over scalar `count` when the hook supports batching; only hooks without batch support use scalar calls. A failed batch never falls back. The adapter validates exact count cardinality, every non-negative safe integer, each per-text ceiling, and the safely summed total over all full inputs. Preparation retains every exact encoder text and its local token count in `encoding.inputs`, together with the reviewed `encoding.maxTokensPerText` ceiling. The operation runner records that evidence and the outbound `wire` before inference. A successful result retains the complete parsed response in `wire`, including the selected choice, confidence, distribution, and original usage fields, alongside the normalized response and locally associated request identity. These records preserve JSON facts, not the response body's whitespace.

## Lifecycle

Each HTTP request fuses the caller cancellation signal with the configured deadline. Provider disposal aborts every owned tokenizer preparation and HTTP request and waits for all of them to settle before disposal completes. The tokenizer plugin unregisters its hook before aborting and draining its HTTP client, so unloaded hooks cannot admit new work. The adapter never retries failed requests or falls back to a different model or endpoint.

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

- The package bundles no tokenizer artifacts or models; its local HTTP hook requires a separately provisioned exact tokenizer service for the configured encoder.
- The credentials service cannot cancel a pending lookup. The local client retains that lookup until settlement during disposal and never starts HTTP from a late value; a credential provider that never settles can delay disposal.
- Local manifest verification records an operator-reviewed immutable deployment; it cannot attest to a remote server beyond that deployment control plane.
- The protocol is a narrow `transition` choice wire, not a general chat-completions or generation API.
- The [supported-profile keyless scenario](../../../snapshots/sdk/clm-operations/snapshot.yml) uses a deterministic judgment provider, not this HTTP adapter. No live provider smoke is recorded for this package; deterministic protocol tests do not establish model quality, calibration quality, or paid Dike evaluation evidence.
- The package is private, experimental, and absent from shipped default profile composition.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published because request preparation and response parsing validate the provider's owned facts before returning them, and disposal drains its owned requests. The package maintains no separate live projection or independently observed state for a `./invariant` entry to compare.

</details>
