# Agent Note: Daedal 工具策略权限模式

Status: implemented

[English](2026-08-18-daedal-tool-policy-permission-mode.md) | 中文

## 问题

挂载 Daedal 的[模型支持型工具策略能力](2026-08-16-model-backed-tool-policy.md)后，每个权限预设都会应用辅助评审。这抹平了普通工作区限制、独立评审的无限制命令与显式 Full access 之间的产品差异。只添加预设标签无法恢复这种差异，因为策略在工具执行前生效，并且必须遵循会话的持久权限状态。

## 决策

`dsh-tool-policy-enforcer` 接受可选的 `enforceWhen` 条件，对 `sandbox/mode` 与 `approval/policy` 进行合取。它会在评估提供方之前，从调用会话的持久事件中折叠已配置的值。省略条件会为现有组合保留无条件执行。缺少已配置值时仍会执行，因为值缺失无法确认绕过条件成立。

Daedal 宿主补丁按展示顺序拥有四项权限表：`read-only`、`workspace-write`、`policy-reviewed` 与 `danger-full-access`。`policy-reviewed` 等于 `danger-full-access + ask`；执行器仅选择这一组合。现有权限投影与 Settings schema 会把新选项传给两个浏览器选择器，因此 UI 无需 Daedal 专用分支。Full access 仍是唯一受[现有显式风险确认](2026-07-31-gui-full-access-confirmation.md)保护的选项。

策略提供方仍只负责其配置的工具。Daedal 评审已映射的 shell 调用与限定范围的 MCP 规则；不受支持的工具继续遵循自身的执行机制。因此，中间模式表示完整文件访问加上对这些受支持操作的独立评审，而不是对每个工具进行通用模型授权。

## 考虑过的替代方案

**直接以预设名称决定是否执行。** 否决，因为沙箱与审批事件是权威机制值，而 `permission/preset` 保存产品意图，并且可能与另一个名称共享同一组合。执行器应遵循决定执行行为的值。

**为权限预设添加第三个机制旋钮。** 否决，因为部署已经可以通过两个持久值的自有判定条件表达是否激活；添加另一个事件会复制状态。

**在浏览器中硬编码 Policy reviewed。** 否决，因为现有投影与 Settings schema 已经保留部署表的顺序、标签与说明。客户端特殊分支会使 Daedal 配置失去权威性。

## 后果

受工作区限制的 Daedal 会话不会发出辅助策略请求。Policy reviewed 会话使用无限制文件权限，同时让受支持的 shell 与 MCP 调用接受独立策略评审，并将真正的询问直接路由到审批服务。Full access 既不执行辅助评审，也不发出审批提示。现有非 Daedal 执行器组合仍保持无条件行为，除非配置 `enforceWhen`。
