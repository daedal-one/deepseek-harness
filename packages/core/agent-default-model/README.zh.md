# @deepseek-ai/dsh-agent-default-model

[English](README.md) | 中文

主 Agent 与部署定义的具名 Agent 角色共用的持久模型选择服务。`AgentModelConfig` 提供 `ctx.agentModels`；直接入口、Host 支撑的入口与具名子 Agent 工具都读取同一个状态所有者，不再分别携带无关的默认模型。

插件配置必须提供 `{ provider, model }`，也可提供 `reasoningEffort`。所有 Agent 角色的提供方由组合层固定。`agent-models` Settings 分节只保存每个角色的模型与可选推理强度，因此图形界面无法把 Agent 悄然切换到另一套凭据或提供方路由。

- `currentSelection(id?)` 返回主 Agent 或某个已注册角色的有效选择。
- `optionsFor(id, fallback?)` 应用角色选择，同时保留输出上限等无关 Agent 选项。
- `registerTarget(target)` 在插件 scope 的生命期内贡献一个具名角色。可见新增或最终移除会发布 `agent-models/directory-updated`；等价贡献会合并且不重复发布变更，冲突定义会失败。
- `saveSelection(selection)` 在挂载 Settings 提供方时持久化主 Agent 的切换。
- 生成的 `agentModels.list/save/reset` Remote namespace 为 Settings > Agents 页面提供精确模型元数据与比较并交换 revision。

每次图形界面保存都会先通过 `ctx.llm` 校验精确的模型与推理强度。过时的 Settings revision 会被拒绝，不会覆盖并发编辑。删除覆盖后，该角色恢复组合层默认值。

## 模型体验

间接影响，通过之后创建的 Agent 所获得的选择产生；本服务不添加任何提示词内容。

#### KV Cache 影响

已存在的 Agent 与 Session 保留日志中的选择。已保存的变更只影响之后的 Agent 启动，不会使已建立的请求前缀失效。

## 已知限制与暂缓事项

- 提供方路由归部署所有，不能在图形页面中修改。
- 具名角色只在贡献它们的插件处于挂载状态时显示；该存活集合变化时，已打开的客户端会重新读取目录。
- 没有可写 Settings 提供方时，目录仍可读，但无法持久化变更。
