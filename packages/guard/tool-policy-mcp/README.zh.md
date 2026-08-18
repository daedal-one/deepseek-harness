# dsh-tool-policy-mcp

[English](README.md) | 中文

这是面向经过精确审查的 MCP 工具面的确定性 `ctx.toolPolicy` 提供者。每个配置的公开工具名称都会获得一条 `allow`、`ask` 或 `deny` 规则。可选的 principal 允许列表从子 Agent 持久化且由配置所有的 subagent descriptor 中派生授权，因此根 Agent 或其他角色不能通过参数或 persona 文本声明访问权。可选的根级 URL 参数可以是单个 URL 或 URL 数组；每个值都必须使用 HTTP(S)、避开非公开字面地址，并且只能解析到公开地址。可选的禁止参数会在发送 MCP 请求前失败关闭。

该提供者与 `dsh-mcp-client` 的注册时工具和参数投影配合使用。投影阻止未经审查的 schema 到达模型；该提供者通过 `dsh-tool-policy-enforcer` 应用执行时授权和直接审批。

## 模型体验

### 条件 MCP 授权反馈

#### 模型看到什么

此提供者不添加提示词或工具 schema。当匹配的 MCP 调用未解析为 `allow` 时，`dsh-tool-policy-enforcer` 会呈现拒绝或打开审批。

#### Token 影响

允许和不支持的调用不增加模型可见 token。拒绝或延迟的调用会在下一请求中增加一条有界工具结果。

#### KV 缓存影响

策略反馈仅追加在可复用的对话前缀之后。规则或 DNS 结果变化会影响后续裁决，但不会替换先前的请求 token。

## 已知限制与延后工作

- DNS 检查发生在另一个 MCP 或浏览器连接之前，无法把后续 socket 固定到已检查的记录。带状态的本地浏览器提供者还应使用 `clientLifetime: agent` 和提供者原生的域名限制。
- 规则使用公开的 `mcp__...` 工具名称，因为这是 `tools/pre-execute` 观察到的稳定标识。
