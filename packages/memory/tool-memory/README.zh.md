# `@deepseek-ai/dsh-tool-memory`

[English](README.md) | 中文

普通记忆 Consumer，提供查询、读取、提案、质疑和检查点工具。项目作用域来自会话工作区；模型不能选择其他项目路径。每次全局变更都在执行时请求批准，并且只在得到 `allowed-once` 后继续。

## 模型体验

### 系统提示词

#### 模型看到的内容

模型看到以下固定策略。

##### 记忆策略

```markdown
Use memory_query before relying on prior facts. Project memory is isolated by the current session workspace. Global proposals and other global writes always require one-time human approval. Proposals are unreviewed until a trusted reviewer accepts them; preserve evidence and link contradictions.
```

#### Token 影响

Consumer 挂载期间具有固定指导成本。

#### KV 缓存影响

策略文本和插件生命周期不变时保持前缀稳定。

### 工具 schema 与结果

#### 模型看到的内容

模型看到生成的 [`memory_query`、`memory_get`、`memory_propose`、`memory_challenge` 和 `memory_checkpoint` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-memory)。读取结果包含有界记录；变更返回完整变更记录或错误。

#### Token 影响

固定 schema 成本，加上数据相关且保留的调用参数和结果。Provider 搜索上限约束查询结果。

#### KV 缓存影响

可见性不变时 schema 保持前缀稳定。调用和结果只追加，不会使已可复用前缀失效。

## 已知限制与延后工作

- 普通工具输入的证据是引用字符串。自动提取器可通过服务定义直接保存更丰富的会话证据。
