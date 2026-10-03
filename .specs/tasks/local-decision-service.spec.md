---
id: TASK:tools/local-decision-service
type: task
status: accepted
summary: Add an opt-in local CPU Kev decision service, exact preparation, and reviewed read-only operation policies.
owners: [carlo]
progress: done
addresses:
  - REQ:tools/operations#c-composition
  - REQ:tools/operations#c-plan
  - REQ:tools/operations#c-policy
  - REQ:tools/operations#c-hard-stops
  - REQ:tools/operations#c-evidence
  - REQ:tools/operations#c-selection
  - REQ:tools/operations#c-provider
  - REQ:tools/operations#c-durability
  - REQ:tools/operations#c-lifecycle
  - REQ:tools/operations#c-replay
  - REQ:tools/operations#c-completion
  - REQ:tools/operations#c-verification
labels: [tools, operations, decision-model, experimental]
---

# Local CPU decision service and read-only operation integration

## Accepted scope

Implement the agreed local CPU design with Kev-4B as the initial deployment candidate, without claiming that it is qualified or the fastest model. Reuse the existing operation runner through a distinct provider; retain the strict CLM provider and its protocol checks. No automatic remote fallback, generated tool arguments, text generation, production mutation, new Operations UI, or model-quality qualification protocol is included.

The work uses an isolated worktree based on the verified CLM implementation. Unrelated changes in the shared checkout remain untouched. The user separately authorizes later model-choice qualification; this task does not download model weights, invoke model inference, deploy or restart services, enable unqualified autonomous execution, or publish a qualification result.

## Serving and identity

Provide a separately supervised, local-only CPU service using a pinned official Kev implementation and locally provisioned base, adapter, head, and tokenizer artifacts. Artifact, serving-code, encoding, precision, and limit identities remain explicit and immutable. No startup downloads, floating artifact revisions, caller-selected models, or credentials in logs are permitted. Preserve raw provider accounting rather than inventing CLM billing units or treating serialized answer tokens as generated text.

One resident inference worker has bounded admission and a bounded queue. Expired or cancelled queued requests do not start. Work remains owned until actual settlement; a hard execution timeout terminates and drains the worker rather than allowing detached computation. Restart may restore service availability but never retries an interrupted request. DSH provider unload stops admission, aborts owned requests, and awaits settlement.

## Preparation and tokenization

Preparation performs no inference. Kev preparation uses its official state/question/option framing and exact tokenizer, not a chat template or independent per-string approximation. Bounded preparation responses identify the immutable recipe, exact input accounting, request association, and candidate ordering. Record exact decision inputs before ranking, and reject truncation, identity drift, missing or reordered inputs, oversized responses, and non-finite counts or probabilities.

Extend the existing CLM tokenizer hook with supported exact batch counting to remove repeated local calls without changing its independently encoded texts, special-token semantics, per-text ceiling, or strict wire contract. Tokenizer workers use pinned local artifacts and bounded request lifecycles; they do not load model weights merely to count tokens.

## Read-only policies

Keep operation eligibility empty unless an explicit composition registers each independently reviewed exact tool-definition instance and its policy through owned effects. Do not bless tool names or introduce scoped shadow definitions to bypass ordinary policy. Normal scope, discovery, approval, permission, execution-world, and sandbox behavior remain authoritative.

The initial eligible family is bounded whole-small-file `read`, `glob`, and `grep`. Expose typed read clipping/completeness facts; acquire bounded raw search output and preserve NUL-delimited UTF-8 glob paths without replacement or BOM loss; explicitly reject unsupported encodings. Treat search targets, including a filename spelled `-`, as literal filesystem sources rather than stdin. Display caps do not imply that canonical evidence was bounded or complete. Empty successful search collections are complete searches, not proof of goal satisfaction. Do not infer completion by parsing rendered text.

Argument policies receive trusted caller/workspace context at admission and again before the body. Validate paths in the actual provider's execution world against component-aware approved-root rules, accepting valid absolute or relative source paths without rewriting their values. Reject unsupported or mismatched filesystem/subprocess worlds. Lexical path restrictions narrow the workload and are not a new symlink-safe read-security boundary. Permit bounded output references for reviewed reads only; reject unknown argument keys and escalation/background modes. Shells, scripts, hooks, writes, delegation, browser/network tools, background work, and recursive operations remain excluded.

## Verification and activation

Add deterministic provider, request-preparation, queue/cancellation/disposal, real-registry policy, producer, and composition coverage without external inference. Extend supported-profile keyless replay and both SDK projections for new model-visible or durable data. Current-writer fixtures may be refreshed under their owning policy; preserve retained Session generations and original compatibility evidence. Update package contracts and the owning Agent Note, generated catalogs, and relevant type/lint/documentation checks.

Keep the runner's required deployment and calibration checks intact. Supplied examples must not fabricate a calibration identifier or mount the feature in shipped default profiles. Serving readiness and deterministic implementation tests do not qualify a model. Record unavailable verification tooling honestly; do not substitute a homemade specification validator for forge-spec or claim unperformed checks.

## Implemented outputs

The [decision service](../../python/decision-service/README.md), [Kev provider and private protocol](../../packages/experimental/operation-kev/README.md), [CLM tokenizer integration](../../packages/experimental/operation-clm/README.md), and [read-only composition](../../packages/experimental/operation-fs/README.md) implement this scope. The [Agent Note](../../.agents/notes/implemented/feature/2026-10-01-local-cpu-decision-serving.md) records the decisions and alternatives.

Independent adversarial review reproduced invalid-UTF-8 filename aliasing and ripgrep stdin-target substitution; strict raw-byte capture and literal target handling resolve both. A subsequent actual-container-provider reproduction found cancellation blocked on an impossible stdout drain. The provider now owns terminal-state observation during backpressure; integrated delayed-removal and mid-drain closure/error regressions cover the correction. E2B's existing closure ownership remains unchanged. Final input review also reproduced an unpaired-surrogate glob pattern selecting a different replacement-character filename. Admission now rejects malformed Unicode in paths, patterns, filters, roots, and cwd before conversion; the real Loader regression proves no subprocess, read, or judgment starts.

## Validation evidence

- Final offline workspace relink, `build:lib:host`, and `typecheck:contracts-ready` passed. The earlier `build:lib:client` and `build:web` artifact pass succeeded; no GUI server was restarted or deployed.
- Provider/tokenizer suites passed 94 tests; the final manifest-equality change separately passed all 50 Kev tests. Generic operation policy/runner/composition coverage passed 73 tests. The final Unicode regression first failed all three negative-control cases, then the complete read-only composition suite passed 34 tests with 100% source coverage on all four metrics; its host rebuild and scoped source/test lint also passed.
- Final producer/search/E2B verification passed 242 tests, including actual-consumer/container-transport cancellation coverage. The search/operation-fs coverage run passed 205 tests with 100% on every runtime search source file. These groups overlap and are not additive totals.
- Python service verification passed 32 offline tests, including actual subprocess and local HTTP lifecycles. The pinned upstream source-only check passed without ML imports or weights.
- Final built keyless replay passed 17 selected SDK/headless/corpus checks. The new authored Kev case retains complete request/token/digest evidence and explicitly synthetic byte-token accounting. Both recorded TypeScript-to-Python SDK projection cases passed; their independent successful-record oracle is unchanged apart from deployment configuration identity.
- Relevant source lint, public-export JSDoc, package dependencies/config ownership/invariant policy, and all 297 NodeNext declaration consumers passed. All 32 documentation gates passed in the final `doc-sync` aggregate run. Catalogs were regenerated through their owning scripts; the configuration catalog's existing root-entry-only coverage does not replace the tokenizer subentry's README configuration documentation.
- Changed-file review and whitespace checks passed. Retained Session generations and the shared checkout were not edited.

## Verification limits and exclusions

`spec lint` could not run because forge-spec is absent (`spec: command not found`, exit 127); no substitute validator or Forge Intellect adherence result is claimed. The user explicitly skipped browser verification, so the Web current-writer snapshot remains unchanged and unverified. No Chromium was provisioned. Model-weight download, actual CPU weight loading/inference, hardware resource measurements, deployment, default activation, and model-choice qualification remain outside this implementation task. The user subsequently authorized completing the final input review, committing the isolated worktree changes, and pushing `codex/local-kev-operations`; that authorization does not include deployment. Pending credential resolution can delay client disposal because that service API has no cancellation parameter; it cannot start late HTTP.
