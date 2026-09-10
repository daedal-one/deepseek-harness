# Forge Intellect verification

The optional Deadal-intellect profile connects durable Forge specifications to native implementation evidence. [The user guide](../user/guide/deadal-intellect.md) owns the conversational workflow; [the integration package](../../packages/integration/forge-intellect/README.md) owns configuration and execution limits.

## Plans and authority

A plan binds the canonical repository path, clean Git revision, durable subjects, source paths, required commands and success markers, reviewer routes, and output limits. Its content digest and policy are revalidated after the approval decision and before job launch. The main assistant can propose a plan but cannot approve it.

Forge Spec owns normative intent. Forge Intellect owns source and action evidence, independent review requirements, supported or contradicted decisions, freshness and attestation eligibility. The Harness service retains plans and job outcomes, and passes native results through without deriving its own adherence status.

## Reviewer isolation

Each native role and stage receives a fresh tool-free agent. Native requests are matched to the retained request file before dispatch. The assessor and challenger see their own planning context and the common executed evidence, without the main conversation or each other's conclusions. Source citations resolve deterministically from captured numbered text. Invalid structures receive bounded correction requests that preserve substantive judgment.

## Retained runs

One process runs one verification at a time. Each run has an immutable plan, a mutable local execution record and native evidence. The record identifies execution completion, failure, cancellation or interruption; native status separately checks whether evidence is authentic and current. Reassessment retains the original execution policy and artifacts while obtaining new reviews. Changed implementations require a fresh run.

Attestation calls the native issuance operation. Complete supported scope, clean exact revision, unchanged evidence and dependencies, and matching implementation provenance remain required. Issuance records local immutable evidence and does not push it to a remote.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxforgeintellect--forgeintellect"></a>

### `ctx.forgeIntellect` — `ForgeIntellect`

Local native provider and application service; model-facing tools live in the scoped ./tool entry.

```ts cordis-catalog
/** Discover repository readiness without executing checks or reviews.
 * @param agent - conversation whose workspace is selected.
 * @param signal - cancellation of discovery.
 * @returns Repository, specifications, reviewer routes, diagnostics and retained runs.
 */
async overview(agent: Agent, signal: AbortSignal): Promise<JsonValue>

/** Prepare an immutable plan without running checks or review models; dirty repositories reject.
 * @param agent - conversation whose workspace is selected.
 * @param input - proposed subjects, source paths and fixed checks.
 * @param signal - cancellation of preparation.
 * @returns Validated plan retained with its native policy.
 */
async prepare(agent: Agent, input: PlanInput, signal: AbortSignal): Promise<Plan>

/** Request approval and start a native verification job; altered plans and stale candidates reject.
 * @param agent - conversation that owns approval and job collection.
 * @param planId - retained execution plan.
 * @param signal - cancellation through approval and launch; the job owns later cancellation.
 * @param callId - originating tool call for the approval audit.
 * @param source - original retained run when reassessing authenticated execution.
 * @returns Retained run, job and effective plan identifiers after successful launch.
 */
async start( agent: Agent, planId: string, signal: AbortSignal, callId?: ToolCallId, source?: string, ): Promise<{ runId: string; jobId: JobId; planId: string }>

/** Revalidate retained evidence and distinguish execution state from assessment and freshness.
 * @param agent - conversation selecting the repository.
 * @param runId - retained run to inspect.
 * @param signal - cancellation of native inspection.
 * @param evidence - include authenticated detailed evidence when true.
 * @returns Native status, or an explicit unavailable diagnostic for incomplete evidence.
 */
async result(agent: Agent, runId: string, signal: AbortSignal, evidence: boolean = false): Promise<JsonValue>

/** Issue a native qualified attestation; failed eligibility rejects without a manual fallback.
 * @param agent - conversation selecting the repository.
 * @param runId - retained run whose evidence supports issuance.
 * @param signal - cancellation of native issuance.
 * @returns Native immutable attestation result after successful local issuance.
 */
async attest(agent: Agent, runId: string, signal: AbortSignal): Promise<JsonValue>
```

Types: [Agent](core.md) · [JobId](jobs.md) · [ToolCallId](tools.md)

Source: [`packages/integration/forge-intellect/src/index.ts`](../../packages/integration/forge-intellect/src/index.ts)
<!-- END GENERATED cordis-surface -->
