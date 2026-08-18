# Agent Note: 模型支持的工具策略能力

Status: implemented

[English](2026-08-16-model-backed-tool-policy.md) | 中文

## 问题

工具授权需要部署规则，同时不能让执行任务的模型自行批准，也不能削弱现有审批审计。Shell 调用还需要独立模型判断且不能使用提供方专用 HTTP；单个分类器的拒绝可能是假阳性，而分类器失败绝不能变成许可。经过审查的 MCP 调用需要执行时 principal 和参数检查，因为投影有限工具 schema 并不等同于授权。

## 决策

该能力由一个 Service Definition、两个 Service Provider 和一个 Consumer 组成。`dsh-tool-policy` 管理 effect 作用域的命名提供者注册，并评估配置的提供者或所有已注册提供者。多个受支持的裁决按 deny 高于 ask、ask 高于 allow 的顺序保守合并。`dsh-tool-policy-shell` 把配置的工具名和参数名映射为 shell 执行，应用固定检查和有序规则，然后通过 `ctx.llm` 获取有界辅助证据。`dsh-tool-policy-mcp` 对经过审查的 MCP 调用应用精确公开工具规则、可信 subagent principal、禁止的根参数和公开 HTTP(S) URL 检查。`dsh-tool-policy-enforcer` 在 `tools/pre-execute` 转换规范裁决，并把人工决定留给 `ctx.approval`。

部署可以把执行器激活范围限制到持久沙箱值与审批值。[Daedal 权限模式决策](2026-08-18-daedal-tool-policy-permission-mode.md)负责该激活条件及其产品预设。

shell 证据和审批机制由[独立工具策略证据决策](../bug-fix/2026-08-18-independent-tool-policy-evidence.md)负责。意图与命令效果使用分离且并发的模型路由，封闭效果进入确定性宿主策略，请求事件保留重建选择器而不复制原始输入，第一次 ask 直接进入 `ctx.approval`。无效输出、超时、路由不可用或提供者失败仍然失败关闭。调用方取消仍是取消。

MCP 策略从持久且由配置所有的 subagent descriptor 推导子 principal，而不采用模型参数或 persona 文本。URL 检查会拒绝非 HTTP(S) 协议、非公开字面地址，以及完整当前 DNS 结果集中包含非公开地址的主机名。DNS 检查无法固定随后打开的 socket，因此另行实现的 MCP 或浏览器连接仍负责提供方原生网络限制。

## 备选方案

**修改 `dsh-tool-bash`。** 拒绝，因为授权必须覆盖所有显式映射的 shell 工具，包括 PowerShell，并且应位于执行器的强制事件，而不是某个模型可见工具实现中。

**暴露模型可见的权限工具。** 拒绝，因为执行任务的模型不能成为下一操作的授权者，且仅靠提示词的协议会被其他调用方绕过。

**通过直接 HTTP 调用分类提供者。** 拒绝，因为这会复制 `ctx.llm` 已拥有的凭据、路由、取消、适配器规范化和提供者配置。

**修改代理循环。** 拒绝，因为 `tools/pre-execute` 是已记录的操作点，能够阻止任何已注册工具主体运行。

**把 MCP 工具投影视为授权。** 拒绝，因为隐藏未经审查的 schema 不会授权剩余调用、不会把调用绑定到可信 subagent principal，也不会在执行时验证安全敏感参数。

## 后果

已知破坏性和凭据操作无需模型延迟即可失败，部署规则保持可配置，不确定操作以失败关闭方式进入现有审计审批路径，切换复核提供者无需重写策略。经过审查的 MCP 工具使用同一裁决和审批流水线，而不信任模型声明的角色。shell 提供者通常并发运行两个辅助请求，只在证据未解决时增加次效果请求；解析只读命令不使用请求。持久决策和审批事件跨进程重启保留，且没有进程内重试状态。MCP URL 检查减少直接访问私有网络的风险，但提供方建立连接前仍存在 DNS 重绑定间隔。
