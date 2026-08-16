# memory/：持久化审阅记忆能力家族

[English](README.md) | 中文

本家族存储带证据的项目或全局知识，使提取语句在审阅前保持待处理状态，并提供普通和 principal 授权的模型工具。

| 包 | 职责 | ctx key |
|---|---|---|
| [`memory/`](memory/README.md) | 定义作用域记录、生命周期操作和 Provider 选择 | `ctx.memory` |
| [`memory-sqlite/`](memory-sqlite/README.md) | 在应用专属 SQLite schema 中持久化审阅记忆 | 注册到 `ctx.memory` |
| [`tool-memory/`](tool-memory/README.md) | 提供普通查询、读取、提案、质疑和检查点工具 | 注册到 `ctx.tools` |
| [`tool-memory-reviewer/`](tool-memory-reviewer/README.md) | 仅在配置的 principal 子级中安装待处理项发现、审阅、取代和删除工具 | 注册到子级 `ctx.tools` |
| [`memory-extractor-llm/`](memory-extractor-llm/README.md) | 在已提交的完成轮次后创建有界项目提案 | 追加提取事件并调用 `ctx.memory` |

[记忆子系统参考](../../docs/subsystems/memory.md)定义与 Provider 无关的数据和服务 API。[持久化审阅记忆 Agent Note](../../.agents/notes/implemented/feature/2026-08-16-durable-reviewed-memory.md)负责审阅、授权、批准、提取和持久化决策。
