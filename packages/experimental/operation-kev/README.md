---
description: "Private local Kev two-phase operation judgment adapter with official preparation evidence and bounded authenticated HTTP."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-operation-kev

## Summary

This private, experimental provider connects the generic [operation runner](../operation/README.md) to the separately supervised local Python decision service. It prepares a complete official System One request without inference, then ranks only the runner's supplied candidates after the runner records and flushes that preparation. It has no chat-generation, tool, argument-construction, approval, retry, or fallback authority. The [private protocol](protocol.md) owns wire fields and service obligations.

## Table of Contents

- [Composition and identity](#composition-and-identity)
- [Preparation and ranking](#preparation-and-ranking)
- [Lifecycle](#lifecycle)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Composition and identity

Mount the operation service and credentials provider before this named plugin. Configure a loopback HTTP origin, a required credential reference, and every deployment identity and transport limit explicitly. No provider profile, model-quality claim, calibration identifier, or deployment is supplied by this package. The runner's existing manifest-verification and calibration requirements remain independent and fail closed.

`model` identifies the immutable model artifacts; `wireModel` identifies the official System One route and is not evidence of artifact identity. `deploymentManifest` requires an operator-reviewed reference and SHA-256 digest of the exact serving-manifest bytes. `deployment` must equal that digest; an unrelated review artifact cannot stand in for this serving identity. Calibration remains a separate declaration about the deployment and is not part of the serving manifest. The service independently echoes model, route, encoder, tokenizer, serialization, dtype, and service limits; every field must match the frozen local declaration. Only the pinned `kev-90512f1c-systemone-choice-v1` recipe and initial `float32` deployment are accepted. The encoder declaration must identify the deployed base and adapter artifacts, not a chat-template name.

`serviceCaps` records the reviewed input-token, vocabulary, candidate, request/response byte, queue, and request/execution timeout limits. The local client separately requires `timeoutMs`, `maxRequestBytes`, `maxResponseBytes`, and `maxConcurrentRequests`; it rejects excess admission instead of adding an unbounded queue. The configuration digest includes these declarations, the endpoint, and credential reference, never the resolved secret. Mutable caller configuration cannot change the provider's route, limits, manifest, or identity after construction.

The plugin resolves `credentialRef` through `ctx.credentials` for each request, allowing secret rotation without identity drift. Credentials are sent only in the authorization header, not in request records, fingerprints, or diagnostics. Endpoint credentials, non-loopback hosts, HTTPS, paths, redirects, and query parameters are rejected. Transport errors omit response bodies and underlying credential or Fetch exception text.

## Preparation and ranking

The provider serializes the official request once, preserving the complete state, question, candidate identifiers, descriptions, Unicode, and JSON content. The Python official encoder owns the actual state and candidate framing; this adapter neither adds a chat template nor estimates tokens by summing independent strings. Bounded preparation replies must match the request's exact UTF-8 digest, deployment identity, token ceiling, vocabulary, and complete token count. The resulting frozen `wire` contains the entire decision envelope, including the original request text and ordered token ids.

The existing `operation/judgment-request` event retains that envelope before inference; no additional session event is necessary. Ranking validates the recorded identity, draft/request association, digest, and token accounting, accepting lossless copies rather than process-local object authority. The service re-encodes the request and rejects changed token evidence before scoring; caller token ids never override model inputs.

Decision parsing requires exact supplied candidate coverage and a finite normalized full-precision probability distribution. The separate official result remains untouched, including its four-decimal probabilities and honest usage; only the known rounding difference is accepted. The provider never renormalizes rounded scores or weakens the strict CLM parser. `usage.billingUnits` is absent when unreported, while reported input and serialized answer-token counts are preserved without labeling them as generated text.

## Lifecycle

The shared [local HTTP client](../operation-clm/src/local-http.ts) uses production Fetch and the maintained deadline primitive. It bounds complete request and response bodies, rejects malformed JSON and UTF-8, stops admission on unload, aborts owned HTTP requests, and waits for their settlement. Registry installation and removal are owned effects. Service-side worker cancellation and actual inference settlement remain the Python supervisor's responsibility; closing an HTTP request alone is not proof that remote computation has stopped.

## Dev Note

No runtime invariant companion is published: request preparation and response parsing validate the provider's owned relationships before returning them, and the client drains its owned requests. There is no independently maintained projection for a runtime invariant to compare. The [provider tests](tests/provider.spec.ts), [transport tests](tests/transport.spec.ts), and [real Loader composition](tests/composition.spec.ts) exercise these relationships without loading model weights or invoking model inference.

## Model Experience

### Closed operation decision

#### What the model sees

The decision model receives exactly one official System One choice question over the runner's complete candidate descriptions and canonical state, including the `complete` candidate in a completion judgment. The planning model does not receive a new tool or prompt from this provider; the operation runner owns its visible results.

#### Token effect

Preparation reports the complete official encoder token sequence and exact input count before inference. Cache-dependent billing or serialized answer tokens do not replace this admission count. The provider rejects oversize inputs instead of truncating them.

#### KV Cache effect

The adapter shares no planning-model KV cache or prompt prefix. Any decision-service caching is deployment-owned and cannot change the recorded request or exact preparation evidence.

## Known Limitations and Deferred Work

- Serving readiness and synthetic tests do not establish model calibration, workload qualification, or comparative model accuracy. Model weights are neither downloaded nor loaded by this TypeScript package.
- Only the pinned official choice recipe and FP32 CPU deployment are supported; other precisions and encoders require separately implemented and reviewed identities.
- Credential resolution has no cancellation parameter in the current credentials service. Disposal retains and awaits an already-started lookup, and a late result cannot start HTTP after cancellation; a credential provider that never settles can therefore delay disposal.
- The HTTP response identity is a consistency check against an operator-controlled local service and reviewed manifest, not remote attestation. The local service must independently verify its artifacts and enforce its worker lifecycle.
- Preparation and ranking have no automatic retry, fallback, generation, or model-quality qualification path and are absent from shipped default profiles.
