# Agent Note：OpenRouter 路由的网页搜索取代 DeepSeek 专用提供方

Status: implemented

[English](2026-08-18-openrouter-web-search.md) | 中文

## 问题

已交付的 `web_search` 路径依赖 DeepSeek 的 Anthropic 兼容 Messages endpoint 和原生搜索工具。尽管 `ctx.web` 与面向模型的工具已经与提供方无关，默认部署仍包含单一厂商的凭据、endpoint、模型词汇、请求字段、响应块与可用性要求，并且需要在会话模型所用的 OpenRouter route 之外再配置一个账户。

OpenRouter 将网页搜索公开为模型请求上的 server tool，而不是独立检索 endpoint。其自动引擎可在所选模型支持时使用提供方原生搜索，否则改用 OpenRouter 托管引擎。因此，更换提供方后仍需要一次辅助模型调用、显式结果归一化、持久请求证据，并且在模型返回无引用答案时失败。

## 决策

基础 bundle 选择 `openrouter` 并挂载 `@deepseek-ai/dsh-web-search-openrouter`。仓库处于预发布阶段，因此已移除的 `@deepseek-ai/dsh-web-search-deepseek` 包及其配置没有兼容读取器。

每次搜索发出一个包含 `openrouter:web_search` server tool 的 Chat Completions 请求。可配置模型默认为 `openrouter/auto`，引擎默认为 `auto`；部署也可以选择 `native`、`exa`、`firecrawl`、`parallel` 或 `perplexity`。`maxResults` 同时成为单次搜索与总结果上限，`maxUses` 同时限制 server 搜索次数与 server tool 总调用次数。请求始终拒绝提供方数据收集。

提供方复用 `OPENROUTER_API_KEY` 和 `OPENROUTER_BASE_URL`，并在可用时通过 `ctx.credentials` 为每次操作解析凭据。会话流量和搜索仍是独立请求：搜索提供方在 `ctx.web` 之后直接调用 OpenRouter，不会用 server tool 行为扩展通用 LLM seam。

第一条 assistant message 成为可选的生成答案。标准化的 `url_citation` annotation 成为去重后的 `WebSearchSource`。没有任何可引用 URL 的响应以 `WEB_PROVIDER_ERROR` 失败；不会从答案文本中解析链接作为后备。发出请求前一刻，提供方向发起请求的 Agent 会话追加 `web/openrouter-search-llm-request`，其中包含已解析 endpoint 与不含密钥的精确请求体。HTTP redirect 会在私有查询正文抵达另一个 origin 前失败。

Web Plugins 卡片编辑 OpenRouter 搜索命名空间的凭据引用、endpoint、辅助模型、引擎与搜索预算。提交的设置从单个快照作用于下一次操作，因此凭据解析不会将一个 revision 的密钥与另一个 revision 的 endpoint 混用。

## 考虑过的替代方案

**在 OpenRouter 默认路径旁保留 DeepSeek 原生搜索。** 不予采纳，因为已交付路径仍需第二个提供方账户，并保留两套默认路由系统。希望直接采用厂商契约的部署仍可在 `ctx.web` 后选择 Exa 或 Perplexity 实现。

**调用独立的 OpenRouter 搜索 endpoint。** 不予采纳，因为该服务将搜索公开为附着于模型请求的 server tool。虚构检索 endpoint 会使 adapter 依赖不受支持的协议。

**只使用 `engine: native`。** 不予采纳，因为这会将模型选择与搜索可用性绑定在一起。`auto` 优先使用提供方原生搜索并保留托管后备；要求固定引擎的部署可以显式选择。

**接受无引用答案。** 不予采纳，因为可移植结果必须包含可归属来源。从答案文本中提取 URL 无法区分引用与附带链接，并会让提供方失败看起来像成功。

**通过 `ctx.llm` 路由辅助请求。** 不予采纳，因为通用 LLM seam 不表示 OpenRouter server tool 及其引用 annotation。提供方私有请求可通过会话事件重建，无需扩大对话模型传输。

## 后果

默认部署只需一个 OpenRouter 凭据即可完成会话与网页搜索，而稳定的 `web_search` 工具和 `ctx.web` 提供方契约保持不变。OpenRouter 可在原生与托管引擎间路由检索，因此已交付路径不再绑定 DeepSeek 搜索，但 `auto` 下的成本、延迟与引擎行为可能变化。

每次搜索都会产生一次辅助模型请求及所选搜索引擎的费用。精确请求会以不含凭据的形式持久化，提供方数据收集被拒绝，redirect 被拒绝，无引用响应会明确失败。组装后的浏览器快照通过本地 OpenRouter 兼容 endpoint 使用真实提供方，并在没有外部网络访问的情况下验证请求、持久事件、来源上限和呈现。
