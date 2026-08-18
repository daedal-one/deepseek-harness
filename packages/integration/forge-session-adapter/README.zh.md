# @deepseek-ai/dsh-forge-session-adapter

[English](README.md) | 中文

本插件是 `forge.agent.session/v1` 的 DeepSeek Harness 实现。Forge 负责持久工作、精确修订版本选择、Temporal 生命周期、执行器分配与策略；适配器接收已分配的执行环境，在第一次模型请求前注入已验证的 Forge Spec v0.6 agent render，并把 Forge Intellect 作为模型唯一可见的工作区操作界面。

## 运行时契约

- `GET /v1/capabilities` 报告协议、命令集、审批语义、checkpoint 支持、限制与证据版本。
- `POST /v1/sessions/{id}/commands` 接收规范化且幂等的 Forge 命令，不要求提供者原生字段。
- `start` 会 fail closed：render 必须使用 `forge-spec-v0.6.0`，SHA-256 必须匹配，lint 错误数必须为零，render 修订版本必须等于会话 intent revision，render target 必须等于持久 work id，且 preflight 必须携带 `forge.intellect.action/v2` 证据。
- 每个 Agent scope 启动 `forge-intellect-action-mcp`，并仅在 `mcp__forge_intellect__*` namespace 下公开 `workspace_read`、`workspace_apply`、`workspace_run`、`workspace_reconcile` 与 `workspace_watermarks`。
- Workspace 与 session ledger identity 使用和 Forge preflight worker 相同的 URL-namespace UUIDv5 推导，使 preflight 与 agent action 保持同一 provenance stream。
- 读取直接允许；工作区变更与命令通过 Harness 审批 seam 提问。`approve` 可以解除待定 Forge 决策，而不会阻塞 Temporal 命令 activity。
- 完整 executor policy 在会话期间不可变。`workspace_apply` 必须明确列入 `tools`；`workspace_run` 的首个 executable 名称也必须列入 `tools`，后续命令无法扩大该列表。
- `close` 在释放会话前协调外部变化并记录 watermarks。证据或清理失败会产生终止结果，绝不会伪装为成功关闭。

可运行组合位于 [`examples/forge-adapter/cordis.yml`](../../../examples/forge-adapter/cordis.yml)。Bearer token、会话状态、适配器状态、Intellect ledger root、graph database、action-MCP 可执行文件与监听端口均由部署配置提供。

## 模型体验

### 持久 Forge intent

#### 模型看到的内容

任何用户 prompt 驱动模型请求前，会话都会收到精确 Forge Spec agent render、持久工作 id、工作区修订版本、target 与 Forge Intellect preflight action id，来源标记为插件。

#### Token 影响

完整 accepted render 在保留的会话上下文中支付一次并保留到 compaction。Forge 通过 render depth 控制其大小。

#### KV Cache 影响

固定工作项与修订版本下保持稳定；新的 accepted intent revision 会有意改变前缀。

### Forge Intellect 操作工具

#### 模型看到的内容

模型只看到五个名为 `mcp__forge_intellect__workspace_*` 的原生工具。结果包含 action protocol、action id、artifact 或 delta 引用、publication 与工作区 watermarks。

#### Token 影响

五个 schema 出现在每次请求中；工具参数与渲染结果文本保留到 compaction。

#### KV Cache 影响

工具 roster 在会话内固定且前缀稳定；action 结果仅追加。

## 已知限制与暂缓事项

- **执行器隔离由 Forge 提供，而非适配器创建**：Forge 必须分配并挂载 canonical absolute workspace，限制网络、凭据、工具与生命周期。Forge Intellect 是可追责网关，不是 sandbox。
- **不声明 pause/resume 命令**：进程重启使用 Harness 的持久会话恢复；operator pause 语义仍是未来的 Forge adapter protocol 扩展。
- **每个会话同时只有一个待定审批**：随附组合使用串行工具调用；并发的第二个问题会 fail closed 为 unavailable。
- **diff 内容作为证据保留**：协议返回 Intellect artifact 与 watermark 引用，不内嵌无界 patch。
