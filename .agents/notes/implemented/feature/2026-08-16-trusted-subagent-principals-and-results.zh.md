# Agent Note: 受信任的 Subagent principal 与结果校验器

Status: implemented

[English](2026-08-16-trusted-subagent-principals-and-results.md) | 中文

## 问题

从另一套 Agent 配置导入的命名角色，需要普通子 Agent 不应获得的能力与完成规则。角色标签、prompt 句子或工具参数都是模型控制的文本，不能授权特权工具。要求状态块之类的完成协议，也不能只靠提醒子 Agent 来可靠执行。

## 决策

Subagent descriptor version 3 携带一个可选的 branded principal；该值由受信任的工具配置选择，并在子 Agent 启动前写入。Principal setup provider 在子 Agent 激活期间安装能力。它们在校验子 Agent 工具过滤器前运行，因此 principal 可以贡献其配置过滤器所命名的精确工具；root 与普通子 Agent 不会收到这些贡献。

Subagent 结果校验器在子 Agent 停稳后、结果交付父 Agent 前运行。校验器会附加结构化警告，但不会重写或丢弃子 Agent 的持久输出。`dsh-subagent-result-status-block` 使用此扩展点检查精确的完成状态块；字段缺失或格式错误时返回有界诊断。

## 考虑过的替代方案

**按角色名或 persona 授权。** 拒绝，因为两者都是模型可见文本，普通子 Agent 可以复制或自行声称。

**全局安装特权工具，再用过滤器隐藏。** 拒绝，因为可见性不等于权限，其他 Consumer 仍可能按已知全局工具名执行。

**在每个 provider 内校验完成协议。** 拒绝，因为完成策略属于委派 Consumer，且必须跨 provider 保持一致。

## 后果

授权依赖持久且由进程拥有的配置，而不是 persona 声明。Memory 审阅工具与 MCP policy 可在每次执行时读取同一 principal 事实。能力安装与结果校验是 subagent service 的扩展点，因此导入角色无需改动 Agent loop。

Principal 是权限事实，不是显示名称。预设必须按信任角色保持 principal 唯一，且不得把它复制给通用子 Agent。警告会影响父 Agent 收到的内容；原始子 Agent 输出仍保留在子 session 中供诊断。
