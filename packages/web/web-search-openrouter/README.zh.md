# @deepseek-ai/dsh-web-search-openrouter

[English](README.md) | 中文

由 [OpenRouter](https://openrouter.ai) 支持的 `WebSearchProvider`，用于 harness 的 [web 能力](../web/README.md)。它发送一个带有 OpenRouter `openrouter:web_search` 服务器工具的辅助 Chat Completions 请求，并将答案与标准化 URL 引用映射为 `WebSearchResult`。

该实现包向 `ctx.web` 注册；它不拥有该服务，也不注册面向模型的工具。它为每次搜索解析 OpenRouter 凭据，在发起请求的 Agent 会话中记录不含密钥的辅助请求，并直接调用 OpenRouter，不依赖 `ctx.llm`。

## 提供方行为

OpenRouter 不将其托管搜索引擎公开为独立检索端点。因此，该提供方会发起一次辅助模型请求。默认的 `engine: auto` 在所选模型支持时使用提供方原生搜索，否则使用 OpenRouter 托管引擎。模型可以搜索零到 `maxUses` 次；不含任何 URL 引用的响应会以 `WEB_PROVIDER_ERROR` 失败，而不会降级为从文本中提取 URL。

请求始终携带 `provider.data_collection: deny`。`maxResults` 同时映射为每次搜索的 `max_results` 和整个辅助请求的 `max_total_results`；`ctx.web` 仍会独立强制执行最终来源数量上限。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | 未设置 | OpenRouter API 密钥字面值。非空值优先；建议使用 `apiKeyEnv`，使配置不含密钥。 |
| `apiKeyEnv` | `OPENROUTER_API_KEY` | 每次搜索通过 `ctx.credentials` 解析的凭据引用；没有该服务时从启动环境解析。值缺失时以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败。 |
| `baseURL` | `https://openrouter.ai/api/v1` | 端点基址；追加 `/chat/completions`。缺省时回退到 `OPENROUTER_BASE_URL`。 |
| `model` | `openrouter/auto` | 辅助 OpenRouter 模型 ID。 |
| `engine` | `auto` | `auto`、`native`、`exa`、`firecrawl`、`parallel` 或 `perplexity`。 |
| `maxTokens` | `4096` | 生成答案的正整数 token 上限。 |
| `maxUses` | `5` | 服务器搜索次数与服务器工具总调用次数的正整数上限。 |

```yaml
- id: web-search-openrouter
  name: '@deepseek-ai/dsh-web-search-openrouter'
  config:
    apiKeyEnv: OPENROUTER_API_KEY
    model: openrouter/auto
    engine: auto
```

Cordis 条目是 `web-search-openrouter` Settings 段的 base 层。每次操作会在解析凭据前对整个有效段做快照，因此已提交的用户层会作用于下一次搜索。`apiKey` 带有 `role('secret')`，所以 `settings.describe()` 只公开该字段是否已设置；凭据字面值通过 `ctx.credentials` 写入和观察。

## 结果映射与失败

第一条 assistant 消息中的非空文本成为 `content`。每个 `url_citation` 注解成为一个来源：`url`、可选 `title`，以及来自引用 `content` 的可选 `snippet`。重复 URL 保留首次引用。OpenRouter 在该响应中不提供可移植的发布时间，因此省略 `publishedAt`。

提供方 HTTP、网络、无效响应和无引用失败变为 `WEB_PROVIDER_ERROR`；调用方取消变为 `WEB_ABORTED`。HTTP 重定向会在接触 `Location` 目标前被拒绝。提供方直接结果报告 `truncated: false`；最终来源截断由 `ctx.web` 服务负责。

## 请求日志

由 Agent 发起的搜索会在派发前一刻追加仅用于日志的 `web/openrouter-search-llm-request` 事件。它记录已解析端点与精确 JSON 请求体，包括模型、查询指令、服务器工具参数、token 上限和数据收集拒绝策略。标头和凭据被排除。派发前的凭据失败和取消不会创建事件；后续请求失败会保留该次尝试。在 Agent 之外直接调用提供方时，没有发起会话可供记录。

## 模型体验

### 辅助 OpenRouter 请求

#### 模型看到的内容

辅助模型接收 `Use web search to answer this query with cited sources: <query>` 作为唯一用户消息，并接收已配置的 OpenRouter 网页搜索服务器工具。该请求与会话模型历史相互独立。

#### Token 影响

每次搜索都会产生辅助模型输入与输出 token，以及 OpenRouter 所选搜索引擎的费用。`maxTokens`、`maxUses`、`maxResults` 和 `max_total_results` 分别限制输出、搜索次数和引用结果。

#### KV Cache 影响

该请求与会话缓存相互独立。模型、工具配置或查询变化会建立不同的辅助前缀。

### 会话工具结果

#### 模型看到的内容

通过 [`dsh-tool-web`](../tool-web/README.md)，会话模型会看到辅助答案与有界、去重后的引用，或消费方错误包装内的提供方确切失败。

#### Token 影响

注册不增加会话 token。答案与引用进入一个工具结果，并保留在后续请求中直至压缩。

#### KV Cache 影响

工具结果仅追加，位于可复用会话前缀之后。

## 已知限制与暂缓事项

- **OpenRouter 搜索需要辅助模型轮次**：当前服务器工具不是独立检索端点，且其 API 仍为 beta。
- **辅助模型可能拒绝搜索**：提示要求使用带引用的网页搜索，但 OpenRouter 服务器工具协议仍由模型决定是否调用；无引用答案会明确失败。
- **`auto` 有意允许后端变化**：OpenRouter 可能使用原生搜索或托管引擎，因此延迟、价格和可用过滤器可能随所选模型与服务路由变化。
- **动态凭据可用性在执行期间解析**：同步的 `available()` 可以确认解析器存在，但无法查询异步凭据存储；选中的无密钥提供方会在操作时失败。
