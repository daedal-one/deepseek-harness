# guard/ — 循环卫生 guard 家族

[English](README.md) | 中文

行为 guard 插件监视 agent loop（智能体循环）中的无效模式，并强制执行单次调用预算。guard 是核心服务和扩展点的自包含消费方，而非可替换能力。

| 包 | 职责 | ctx key |
|---|---|---|
| [`repeat-tool-reminder/`](repeat-tool-reminder/README.md) | 针对重复工具调用的建议性提醒 | 监听工具和 agent 事件 |
| [`timeout-policy/`](timeout-policy/README.md) | 以部署策略形式设置单次工具调用截止时间 | 注册 `tools/execute` 监听器 |
| [`tool-policy/`](tool-policy/README.md) | 定义持久化工具策略分类与延迟决策 | `ctx.toolPolicy` |
| [`tool-policy-shell/`](tool-policy-shell/README.md) | 用确定性规则与有界 LLM 复核分类 shell 意图 | 注册到 `ctx.toolPolicy` |
| [`tool-policy-mcp/`](tool-policy-mcp/README.md) | 授权精确 MCP 工具面，并拒绝不安全的 URL 或参数值 | 注册到 `ctx.toolPolicy` |
| [`tool-policy-enforcer/`](tool-policy-enforcer/README.md) | 在执行前强制应用已配置的工具策略 | 注册 `tools/execute` 监听器 |
| [`english-output-guard/`](english-output-guard/README.md) | 通过可审计翻译器改写目标模型的非英文输出 | 包装 `ctx.llm` stream |

提醒作为 `additionalContexts` 随 `tools/post-execute` 决策传递，并作为来源于插件的 `user/message` 事件追加记录（[工具](../../docs/subsystems/tools.md)）；跨 `dsh-timeout`、能力终止与本策略层的超时拆分记录在[超时库 Agent Note](../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md)。
