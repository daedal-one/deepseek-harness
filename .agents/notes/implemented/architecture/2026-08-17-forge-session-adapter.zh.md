# Agent Note：Forge 会话适配器与可追责工具平面

Status: implemented

[English](2026-08-17-forge-session-adapter.md) | 中文

## 问题

Forge 已接受 DeepSeek Harness 作为首个 coding-harness 适配器，但 fork 尚未公开 `forge.agent.session/v1` endpoint。通用 coding 组合还会直接发布本地 filesystem 与 shell 工具，因此 Forge 会话无法证明它从 accepted intent 开始，也无法证明所有工作区读取、变更、命令、diff 与 checkpoint 都进入了 Forge Intellect。

## 决策

`@deepseek-ai/dsh-forge-session-adapter` 在经过认证的 HTTP 边界翻译 Forge protocol。它要求 Forge 预先分配 canonical executor workspace；除非 Forge 提供精确 intent revision 的、digest 已校验的 `forge-spec-v0.6.0` agent render、零 lint 错误以及相关联的 `forge.intellect.action/v2` preflight 证据，否则拒绝 `start`。该 render 会在任何用户消息驱动模型请求前注入。

每个由适配器创建的 Agent 都获得一个 scoped `dsh-mcp-client` 实例，连接 `forge-intellect-action-mcp`。精确的五个 action 工具构成模型可见的全部工作区界面。读取可以继续；变更与命令使用 Harness approval seam。适配器会在 approval boundary 返回，使 Temporal 可以随后发送 `approve` 命令，而不会与活动 turn 死锁。

适配器 event sequence、causality 与命令响应在进程重启后仍保持持久和幂等。Checkpoint 与 diff 命令发布 Intellect 证据。关闭操作会在释放前协调外部字节并读取最终 watermarks；证据与清理失败都是显式终止结果。

## 考虑过的替代方案

**让 Forge 调用现有 JSON-RPC coding-agent demo。** 拒绝，因为该 surface 既不协商 Forge capability，也不组合逐会话 Intellect 工具与审批。

**保留本地 shell 和 filesystem 工具，事后镜像 telemetry。** 拒绝，因为事后观察无法证明读取的精确字节，也无法证明导致变更的 causal action。

**把 Forge Intellect 当作 sandbox。** 拒绝，因为 action gateway 提供可追责性和 workspace containment，而不提供网络或进程隔离。Forge 仍负责 executor 分配与策略。

## 后果

Harness 原生 event 与 persistence 保留在一个 versioned adapter 后面，Forge 负责持久 work 与 lifecycle。精确 intent 对模型可见，所有工作区能力都有 attribution。发布的 adapter image 必须打包兼容 action-MCP binary，Forge 必须提供隔离 executor；部署绝不依赖 mutable sibling checkout。
