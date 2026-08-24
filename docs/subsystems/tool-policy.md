# Tool authorization policy

The tool-policy capability evaluates a tool execution through named providers before the tool body runs. The [model-backed tool-policy decision](../../.agents/notes/implemented/feature/2026-08-16-model-backed-tool-policy.md) owns the provider seam and exact MCP authorization; the [independent evidence decision](../../.agents/notes/implemented/bug-fix/2026-08-18-independent-tool-policy-evidence.md) owns shell evidence separation, and the [deferred-approval decision](../../.agents/notes/implemented/feature/2026-08-24-deferred-tool-policy-approval.md) owns escalation timing. This page records the provider-neutral types and service API declared by [`dsh-tool-policy`](../../packages/guard/tool-policy/src/index.ts).

## Requests and verdicts

A request carries the immutable execution identity, arguments, owning agent, and caller cancellation. A provider returns `undefined` without side effects when it does not support the tool, or returns a bounded verdict suitable for durable audit.

```ts type-equiv
/** Stable decision classes understood by enforcement consumers. */
type ToolPolicyDecision = 'allow' | 'ask' | 'deny'
```

```ts type-equiv
/** Opaque identity of one registered tool-policy provider. */
type ToolPolicyProviderId = Branded<'ToolPolicyProviderId'>
```

```ts type-equiv
/** Bounded provider opinion retained for audit without raw arguments. */
interface ToolPolicyOpinion {
  readonly providerId: ToolPolicyProviderId
  readonly decision: ToolPolicyDecision
  readonly risk: number
  readonly categories: readonly string[]
  readonly reason: string
}
```

```ts type-equiv
/** Canonical effective verdict returned by the service. */
interface ToolPolicyVerdict extends ToolPolicyOpinion {
  readonly opinions: readonly ToolPolicyOpinion[]
}
```

```ts type-equiv
/** Immutable execution facts supplied to a policy provider. */
interface ToolPolicyRequest {
  readonly callId: CallId
  readonly toolName: string
  readonly arguments: unknown
  readonly agent: Agent
  readonly signal: AbortSignal
}
```

```ts type-equiv
/** Session facts supplied before an enforced turn is likely to execute a tool. */
interface ToolPolicyPrewarmRequest {
  readonly session: Session
  readonly signal: AbortSignal
}
```

## Provider registration and composition

Provider plugins register one stable id for their effect lifetime. Configuration selects an ordered provider set; omission evaluates every registered provider in parallel. Unsupported providers disappear from the result. One supported verdict passes through, while overlapping verdicts combine as deny over ask over allow, with maximum risk and merged categories and opinions. Missing configured providers and an empty unconfigured registry reject evaluation instead of silently permitting the tool.

```ts type-equiv
/** One implementation of policy for a subset of tools. */
interface ToolPolicyProvider {
  /** Start optional reusable preparation without delaying the calling session event. */
  prewarm?(request: ToolPolicyPrewarmRequest): Promise<void>
  /** Evaluate a supported tool, or return `undefined` without side effects when unsupported. */
  evaluate(request: ToolPolicyRequest): Promise<ToolPolicyVerdict | undefined>
}
```

## Enforcement and audit

The enforcement Consumer runs at `tools/pre-execute`: allow and unsupported verdicts delegate, deny short-circuits, and ask returns its reason to the acting agent until the configured consecutive-identical threshold enters the existing approval path. Provider and effective decisions are durable without duplicating raw arguments already stored in `tool/call`. Auxiliary requests log fixed prompts plus reconstruction selectors and bounds before dispatch; independent intent and command-effect inputs remain in their existing session events.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtoolpolicy--toolpolicyservice"></a>

### `ctx.toolPolicy` — `ToolPolicyService`

Effect-scoped named policy-provider registry.

```ts cordis-catalog
/**
 * Register one stable provider id.
 * @param id - non-empty deployment-local provider id.
 * @param provider - implementation owned by the registering plugin.
 * @returns idempotent disposer for this exact registration.
 */
register(id: ToolPolicyProviderId, provider: ToolPolicyProvider): () => void

/**
 * Start reusable preparation in every selected provider that supports it.
 * @param request - session and cancellation for this prewarm opportunity.
 * @returns when every selected provider's preparation has settled.
 */
async prewarm(request: ToolPolicyPrewarmRequest): Promise<void>

/**
 * Evaluate one execution through the selected provider.
 * @param request - immutable call identity, arguments, agent, and cancellation.
 * @returns a canonical verdict, or `undefined` when the selected provider does not support the tool.
 * @throws when a configured provider is absent or a selected provider rejects.
 */
async evaluate(request: ToolPolicyRequest): Promise<ToolPolicyVerdict | undefined>
```

Source: [`packages/guard/tool-policy/src/index.ts:75`](../../packages/guard/tool-policy/src/index.ts)
<!-- END GENERATED cordis-surface -->
