# Agent Note：OpenRouter 负责对话模型，Agent 角色负责选择

Status: implemented

[English](2026-08-17-openrouter-agent-model-settings.md) | 中文

## 问题

对话模型传输、提供商凭证、带路由的模型标识符和 Agent 角色默认值是不同的关注点。提供商专用 adapter 会重复 pi-ai 已维护的传输行为，而嵌在组合文件中的模型选择无法给图形客户端提供一份可完整编辑的目录。OpenRouter 路由后缀又增加了一层区别：`:nitro` 改变提供商排序，但 reasoning 是独立的请求选项，必须在配置校验、Agent 创建、持久 request header 和 OpenRouter 线上载荷之间保持显式。

## 决定

**pi-ai 是唯一随产品交付的对话模型 adapter，OpenRouter 是固定的部署 route。**Base、Headless、Web、ACP、SDK 和 Python runtime 组合都通过 `llm-pi-ai` 注册 OpenRouter；专用 DeepSeek LLM 包和 route 不存在。Web search 会发出独立的辅助 OpenRouter 请求，因为它实现 Web capability，而不是对话模型传输。

**带路由的标识符是安装目录之上的增量 alias。**`modelAliases` 增加一个线上请求 id，同时要求指定安装 provider 目录中的 `catalogModel`。Alias 先继承协议、endpoint、容量、模态、reasoning 方言、支持的 effort map、兼容字段和成本元数据，再应用显式 override。它不能替换安装 id、不能和替换式 `models` 列表共存，也不能指向未知目录条目。因此，随产品交付的 alias `deepseek/deepseek-v4-flash-0731:nitro` 在发送精确 dated Nitro id 的同时保留目录中的 OpenRouter reasoning 协议。

**Agent 模型配置是一份由 lifecycle 管理的目录。**`ctx.agentModels` 固定 provider route，并注册 `main` 以及 `subagent`、`subagent-fork` 等具名贡献者。等价注册按引用计数合并；label 或默认值冲突时立即失败。可见注册或最终移除会发布包含故障隔离的提交后失效通知，remote client 据此重新读取目录。没有显式默认值的具名 target 在注册时继承 main 的部署默认值，因此之后仅针对 `main` 的用户 override 不会把各自独立配置的角色暗中耦合起来。

**选择以角色为单位保持完整，并在之后启动 Agent 时生效。**`agent-models` settings section 为每个稳定角色 id 保存 model 和可选 reasoning effort。Main session 入口和 subagent tool 创建 Agent 时读取当前选择。运行中的 Agent 保留已经 assemble 的选择；持久 `request/header` 事件继续重建每一个模型可见请求。声明式 `AgentOptions.reasoningEffort` 由 agent-loop schema 校验并写入第一个请求，因此选择不会在组合与 dispatch 之间消失。

**Web client 编辑角色，而不是传输 route。**Settings 提供独立的 Agents 页面，背后使用生成的 `agentModels` Remote service。页面通过框架绑定的 snapshot source 观察转发的目录失效通知，并在存活 preset 角色变化后重新获取数据。每张角色 card 从精确的 OpenRouter catalog 选择模型，把 reasoning 选择限制在该模型公布的 effort 范围内，通过 settings revision 的 compare-and-swap 保存，并可恢复部署默认值。写入前会解析精确的 provider、model 和 effort；未知角色、不可用模型、不支持的 effort、只读 settings 和过期 revision 都会被拒绝。

**OpenRouter onboarding 留在 provider editor。**首次设置通过共享 credentials service 写入 `OPENROUTER_API_KEY`，并编辑 `llm-pi-ai/providers/openrouter` settings path。模型传输留在 Models 页面；Agent 角色分配留在 Agents 页面。

## 影响

默认对话 route 是 `openrouter`，model 为 `deepseek/deepseek-v4-flash-0731:nitro`，effort 为 `xhigh`。pi-ai 把该 effort 序列化为 OpenRouter 的嵌套 `reasoning: { effort: "xhigh" }` 对象；Nitro 后缀只请求按吞吐量排序 provider。一条 keyless assembled snapshot 从真实单次运行组合中捕获这两个字段；图形化 Web snapshot 覆盖 main 角色的保存、重新加载和恢复，同时角色目录包含 subagent 贡献者。

配置有意分成两个位置。Provider 凭证、endpoint、header 和 catalog 定制位于 `llm-pi-ai`；逐角色 model 和 reasoning 选择位于 `agent-models`。仓库处于预发布阶段，因此没有兼容读取器接受已删除的专用 DeepSeek provider 配置；错误配置必须在加载时失败，而不能借助陈旧 route 表面上继续工作。

## 考虑过的替代方案

- **在 pi-ai 旁保留专用 adapter**：为一个 provider 重复请求序列化、retry 集成、catalog 元数据、凭证和图形编辑。
- **把 `:nitro` 当作不继承元数据的模型**：能发送路由 id，却会丢失正确请求所需的 reasoning 方言和 effort 词汇表。
- **只保存一个全局默认模型**：无法表达 main、spawn 和 fork 各自独立的角色选择，也不给具名贡献者提供图形身份。
- **保存后修改运行中的 Agent**：会让一个 live session 的模型可见行为脱离正常 request-header transition，并把偶发 settings 写入变成 lifecycle event。
