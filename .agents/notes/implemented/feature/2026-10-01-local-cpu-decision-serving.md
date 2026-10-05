# Agent Note: Local CPU decision serving and read-only operation policies

Status: implemented

## Problem

The [CLM operation adapter](2026-09-28-clm-system-one-operation-adapter.md) supplies bounded ranking and durable evidence, but a CPU-local deployment also needs a supported scorer, exact input preparation, explicit artifact identity, and lifecycle ownership. Production filesystem tools cannot become eligible merely because their names resemble the synthetic readers: their canonical results must preserve complete source values and expose truncation.

## Decision

The [Kev provider](../../../../packages/experimental/operation-kev/README.md) uses a private two-phase protocol with the [Python decision service](https://github.com/daedal-one/decision-engine). Preparation returns the exact official encoding evidence without inference; the runner persists the complete decision envelope before ranking. The service re-encodes that request rather than accepting caller tensors. One exact-byte serving-manifest digest binds both the deployment and its verification declaration. Calibration remains a separate declaration, and serving readiness does not qualify a model.

The initial runtime uses the pinned official Kev implementation, explicit local base/adapter/head/tokenizer artifacts, unmerged adapters, CPU eager execution, and float32. The service verifies local inventories and dependency versions, prohibits floating revisions and downloads, authenticates loopback requests, and supervises one bounded worker. Cancellation and execution timeout terminate and join active work; worker failure requires operator restoration, never an automatic retry. The provider owns its HTTP requests, not the separately operated daemon.

The full-precision scorer distribution accompanies the unchanged rounded official answer and honest usage. The provider validates both without renormalizing or weakening the generic runner or strict CLM parser. CLM instead gains an optional exact batch-tokenizer hook; tokenizer-only serving loads no model weights.

The [operation-fs composition](../../../../packages/experimental/operation-fs/README.md) mounts only read/glob/grep and binds policies to their exact registered definitions. Ordinary discovery, permissions, approvals, and dispatch remain authoritative. Trusted caller cwd is pinned across the operation, with fresh validation before each body. Host-world path mappings and approved roots narrow the workload; lexical checks do not provide symlink-safe confinement. This standalone read-only composition is not a transparent replacement for the complete filesystem family.

Canonical read results expose byte and line clipping. Search captures bounded raw stdout before UTF-8 decoding, preserves NUL-delimited filenames, rejects unsupported encoding, and treats search targets as literal filesystem paths rather than stdin. Input admission also rejects unpaired Unicode surrogates before UTF-8 conversion can substitute a different path or pattern. Display limits never certify complete evidence. Subprocess backpressure waits settle when a consumer closes its pipe, while remaining multiplexed frames drain; pipe closure is not proof of process exit.

## Alternatives considered

**Adapt Kev responses to the CLM wire parser.** Fabricating billing units or zero output tokens would erase real accounting, and accepting rounded distributions would weaken existing checks. A distinct provider keeps both protocols explicit.

**Use a text-generation or GGUF approximation.** A chat template, quantized conversion, or generated decision text is not the pinned official scorer and encoder. These choices require separate implementation and qualification rather than an implicit compatibility claim.

**Authorize filesystem tool names or parse rendered truncation markers.** Names can identify different definitions, and display text can contain literal marker strings or omit canonical data. Exact definition registration and typed producer facts retain ordinary tool authority and source evidence.

## Consequences

The feature remains opt-in, with deployment and calibration gates intact and no shipped-profile activation. The separate engine owns artifact provisioning and real-weight deployment evidence; model-choice qualification remains independent. The [operation-only planning note](2026-10-05-operation-only-planning.md) owns broad coding admission and planner feedback. The Python implementation and synthetic HTTP/SDK fixtures verify protocol and ownership behavior, not model quality.

The credential service has no cancellation parameter: a pending credential lookup remains owned and can delay provider disposal, but cannot start late HTTP. Browser verification is explicitly skipped at the user's request; the separate Web snapshot owner remains unchanged. Forge-spec is unavailable in the implementation environment, so the [accepted task](../../../../.specs/tasks/local-decision-service.spec.md) records that validation gap rather than substituting another validator.
