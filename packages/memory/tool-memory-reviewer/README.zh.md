# `@deepseek-ai/dsh-tool-memory-reviewer`

[English](README.md) | 中文

特权记忆 Consumer，仅在携带配置所选 principal 的 subagent 子级中提供待处理项发现、审阅、取代和删除操作。根级和普通子级不会获得审阅者提示词或工具 schema。每次执行还会折叠持久化 subagent 描述符并要求同一 principal；任何模型参数、persona 或角色字符串都不能声明审阅者权限。全局变更还要求 `allowed-once` 批准。

## 模型体验

### Principal 作用域提示词与工具

#### 模型看到的内容

只有 principal 匹配的子级会看到审阅策略以及生成的 [`memory_list_pending`、`memory_review`、`memory_supersede` 和 `memory_delete` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-memory-reviewer)。根级和普通子级都看不到。待处理读取返回有界的提案和受质疑记录；变更返回完整记录或错误。

#### Token 影响

固定提示词和 schema 成本只存在于匹配子级中，另加数据相关且保留的调用参数和结果。

#### KV 缓存影响

Principal 能力保持安装时前缀稳定。添加或撤销能力会从首个变化的提示词或 schema token 起使复用失效；调用和结果只追加。

## 已知限制与延后工作

- 只有持久化 principal 匹配的会话型 subagent 可使用这些工具。其他 Provider 系列必须先提供同等持久、由进程拥有的 principal，才能充当审阅者。
