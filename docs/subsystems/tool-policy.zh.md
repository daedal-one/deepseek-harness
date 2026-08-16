# 工具授权策略

[English](tool-policy.md) | 中文

工具策略能力在工具主体运行前通过命名提供方评估工具执行。[模型支持的工具策略决策](../../.agents/notes/implemented/feature/2026-08-16-model-backed-tool-policy.md)负责安全依据、分类器升级、精确 MCP 授权和延迟审批；本页记录 [`dsh-tool-policy`](../../packages/guard/tool-policy/src/index.ts) 声明的提供方无关类型与服务 API。

## 请求与裁决

请求携带不可变的执行标识、参数、所属 agent 和调用方取消信号。提供方不支持该工具时无副作用地返回 `undefined`，否则返回适合持久审计的有界裁决。

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

## 提供方注册与组合

提供方插件在其 effect 生命周期内注册一个稳定标识。配置选择一个有序提供方集合；省略时会并行评估所有已注册提供方。不支持该工具的提供方不会进入结果。一个受支持裁决会直接通过，多个裁决则按 deny 高于 ask、ask 高于 allow 的顺序组合，并保留最高风险以及合并后的类别和意见。缺失已配置提供方或未配置且注册表为空时，评估会拒绝，而不是静默允许工具。

```ts type-equiv
/** One implementation of policy for a subset of tools. */
interface ToolPolicyProvider {
  /** Evaluate a supported tool, or return `undefined` without side effects when unsupported. */
  evaluate(request: ToolPolicyRequest): Promise<ToolPolicyVerdict | undefined>
}
```

## 执行与审计

执行 Consumer 在 `tools/pre-execute` 运行：allow 和不支持裁决会委托，deny 会短路，ask 在达到精确调用重试阈值后进入现有审批路径。提供方和最终裁决会持久化，但不重复 `tool/call` 已存储的原始参数；分类器输入会在辅助模型请求前记录。

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
 * Evaluate one execution through the selected provider.
 * @param request - immutable call identity, arguments, agent, and cancellation.
 * @returns a canonical verdict, or `undefined` when the selected provider does not support the tool.
 * @throws when a configured provider is absent or a selected provider rejects.
 */
async evaluate(request: ToolPolicyRequest): Promise<ToolPolicyVerdict | undefined>
```

Source: [`packages/guard/tool-policy/src/index.ts:66`](../../packages/guard/tool-policy/src/index.ts)
<!-- END GENERATED cordis-surface -->
