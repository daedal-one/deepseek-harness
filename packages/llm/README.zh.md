# llm/ — LLM 能力家族

[English](README.md) | 中文

LLM（大语言模型）seam 及其提供方适配器。`llm` 包同时承担 Service Definition 和 Consumer 角色：抽象服务、内容块词汇和流式分片组装器。提供方适配器注册到 `ctx.llm`。这些全是**产品**包。

| 包 | 职责 | ctx key |
|---|---|---|
| [`llm/`](llm/README.md) | LLM 服务和共享流式词汇 | `ctx.llm` |
| [`token-meter/`](token-meter/README.md) | 可感知回放的 token 测量 | `ctx.tokenMeter` |
| [`llm-retry/`](llm-retry/README.md) | 提供方作用域的重试策略 | 监听 `agent/request-error` |
| [`llm-pi-ai/`](llm-pi-ai/README.md) | 多提供方 pi-ai 适配器 | 注册到 `ctx.llm` |

适配器在 seam 上注册提供方路由；重试与 token 测量仍是独立消费方。子 README 负责路由、元数据、回放和提供方协议细节；[OpenRouter 架构决策](../../.agents/notes/implemented/architecture/2026-08-17-openrouter-agent-model-settings.md)说明已交付的提供方拓扑。

子系统参考——消息与内容块、模型请求、`StreamChunk` 协议、适配器约定（adapter contract）——见 [docs/subsystems/llm-streaming.md](../../docs/subsystems/llm-streaming.md)（token 计量：[token-meter.md](../../docs/subsystems/token-meter.md)）；另见 [OpenRouter 提供方拓扑](../../.agents/notes/implemented/architecture/2026-08-17-openrouter-agent-model-settings.md)、[回放 token 计量](../../.agents/notes/implemented/architecture/2026-07-15-replay-token-meter-service.md)与[按路由模型上下文](../../.agents/notes/implemented/architecture/2026-07-20-routed-model-context-and-compaction-policy.md) Agent Note。
