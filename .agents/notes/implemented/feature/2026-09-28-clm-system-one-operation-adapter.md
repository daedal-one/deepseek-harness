# Agent Note: CLM System One operation adapter

Status: implemented

## Problem

A closed-set operation checkpoint needs a bounded CLM ranking request without claiming that an HTTP response proves the deployed model artifacts.

The original adapter invented request and response fields outside the pinned CLM protocol, which made token budgeting, identity validation, and transport-completeness checks inaccurate.

## Decision

`@deepseek-ai/dsh-experimental-operation-clm` sends the pinned `POST /v1/systemone` choice request with state, model, temperature, instructions, and complete candidate criteria only.

It accepts the corresponding model, transition choice answer, probability distribution, and usage response only after exact shape, candidate, distribution, status, bounded-body, and JSON-completeness validation.

The adapter records the configured provider, model, encoder, tokenizer, serialization, deployment, calibration, and optional local deployment-manifest verification in the operation identity.

The response model field must match the configured model, but the response supplies no immutable deployment proof.

Autonomous operation acceptance therefore requires an explicit local deployment-manifest verification record, and requires calibration whenever the operation policy enables its calibration rule.

Local token budgeting counts the same prose texts the pinned upstream schema encodes: rendered state plus instructions, and each candidate description separately.

The provider preserves upstream usage as provider accounting without equating cache-dependent `input_tokens` to the local budget.

A configured credential reference resolves through `ctx.credentials` for each request and reaches only the authorization header.

## Alternatives considered

**Echo deployment identity through the CLM request and response.** Rejected because the pinned upstream wire has no such fields, so accepting them would validate a fictional protocol rather than the serving deployment.

**Count canonical request JSON.** Rejected because the upstream state and action encoders receive rendered prose texts, not JSON key syntax or wrappers.

**Treat the response model name as deployment attestation.** Rejected because a model name cannot bind the endpoint to immutable model, encoder, tokenizer, or serving artifacts.

**Read credentials once during plugin activation.** Rejected because the credential seam resolves references per operation and a rotated value must reach the next request without plugin reload.

## Consequences

Deployments provide an exact `/v1/systemone` endpoint, a temperature, and an operator-reviewed manifest reference and digest before they enable autonomous operation execution.

The adapter remains a narrow single-request provider: it has no retries, fallback model, response-side deployment identity, or text generation authority.

Focused tests pin the actual request and response wire, rendered encoder texts, cache-independent token accounting, malformed distributions, body and status completeness, identity mismatch, cancellation, disposal, credential resolution, operation hard stops, ordering, and model-free interrupted replay.
