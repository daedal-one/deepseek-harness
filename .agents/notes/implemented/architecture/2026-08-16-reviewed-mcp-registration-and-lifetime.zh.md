# Agent Note: 经审阅的 MCP 注册与逐 Agent 生命周期

Status: implemented

[English](2026-08-16-reviewed-mcp-registration-and-lifetime.md) | 中文

## 问题

MCP server 发现的工具列表过去会被整体注册。子 Agent 的工具过滤器可以对该子 Agent 隐藏工具，但父 Agent 仍能看到服务器的全部能力，包括超出目标角色的变更操作。Provider annotation 只具描述性；模型控制的 session 或 page 标识可跨越 Agent session；stdio server 也绕过了 harness 的子进程生命周期。

## 决策

`dsh-mcp-client` 在注册时投影经审阅的原始工具 allowlist。每个配置名称都必须出现在发现结果中。部署拥有的参数可被移除、绑定到执行 Agent 的持久 session id，或在请求到达 provider 前由已验证的来源 URL hostname 填充。投影不匹配会让同步失败，而不是发布不完整或更宽的界面。

MCP policy 是按精确公开工具名匹配的 Tool Policy provider。它在执行前拒绝不受信任的 principal、私有或本地 URL 目标、被禁止的 provider 参数与格式错误的 URL；经审阅的外部变更走普通的延迟审批路径。受信任的 principal 来自持久的 subagent descriptor，绝不来自工具参数或 persona。

有状态的浏览器 provider 使用 `clientLifetime: agent`。发现仍位于 plugin scope，而执行 client 为一个存活 Agent 延迟创建，并随该 Agent 关闭。Stdio 启动经由 `ctx.subprocess`，因此进程树终止、环境处理与 teardown 与其他 harness 子进程使用相同生命周期。

## 考虑过的替代方案

**只依赖 subagent 工具过滤器。** 拒绝，因为根 Agent 仍会收到完整 MCP 注册，且过滤器不校验模型控制的参数。

**共享一个浏览器 client，并在 prompt 中约定 id namespace。** 拒绝，因为 prompt 不执行所有权校验，被猜到或保留的 provider id 仍可能跨 session 使用。

**由 SDK transport 直接启动 stdio。** 拒绝，因为该进程会绕过 harness 的进程树与环境生命周期。

## 后果

注册的 schema 就是经审阅的能力界面，而不只是子 Agent prompt 约定。父 Agent 无法调用被省略的 provider 工具，命名角色也无法通过修改文本借用另一角色的权限。逐 Agent client 防止 provider 状态意外跨并发 session 共享。

请求跨过 MCP 进程边界后，HTTP redirect 与 DNS 验证仍由 provider 负责。OAuth 协商、启动超时配置与无损原生非文本投影仍不受支持；预设不得承诺这些行为。
