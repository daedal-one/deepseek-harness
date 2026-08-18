# Agent Note: 已交付组合中的默认 Web 搜索

Status: implemented

[English](2026-07-31-web-default-search.md) | 中文

## 问题

该 harness 已具备完整的 Web 能力体系：提供方注册表、多个搜索提供方、本地抓取、稳定的面向模型工具，以及结构化结果呈现，但已交付的 `dsh web` 组合没有挂载其中任何一项。除非部署提供自定义覆盖层，否则模型无法发现最新信息。仅挂载提供方仍无法打通 WebUI 链路：Models 页面通过 `ctx.credentials` 存储凭据，而只在插件加载时固定读取进程环境的提供方无法观察在运行中输入或轮换的密钥。

## 决策

`apps/cli/config/base.cordis.yml` 明确挂载 `dsh-web`，配置 `searchProvider: openrouter`，同时挂载 `dsh-web-search-openrouter`，并以 `fetch: false` 和 `searchTimeoutMs: 60000` 挂载 `dsh-tool-web`。它不挂载 `dsh-web-fetch-http`，也不选择抓取提供方。共享 base 只将 `web_search` 设为 TUI、浏览器与无头会话的默认工具。显式搜索提供方 id 使选择不受注册顺序影响，同时个人覆盖层或 `--config` 覆盖层仍可替换或禁用这些配置项。已交付的一分钟预算用于覆盖一次辅助 OpenRouter Chat Completions 请求及服务端检索，同时保持 `dsh-tool-web` 提供方无关的 30 秒默认值不变，以供自定义组合使用。[OpenRouter 搜索决策](2026-08-18-openrouter-web-search.md)定义当前提供方选择。

OpenRouter 搜索使用与已交付会话 route 相同的 `OPENROUTER_API_KEY` 凭据引用。提供方在每次搜索内部通过可选的 `ctx.credentials` 服务解析该引用；只有未挂载该 seam 的组合才会回退到启动进程的环境变量，非空的 `apiKey` 字面值仍作为程序化配置的最后兜底。因此，由 Web 的 Models 页存储或轮换的密钥无需重启即可用于下一次搜索，提供方也无需保留该值。由于 `WebSearchProvider.available()` 是同步方法，它会将已安装解析器视为本地可用；若动态凭据缺失，操作会以提供方专属错误码 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败，而稳定的工具 schema 仍保持注册。

搜索复用 `OPENROUTER_BASE_URL`，但仍是与会话轮次分离的 Chat Completions 请求。每次 `web_search` 都携带 OpenRouter server tool，并自动选择原生或托管引擎。发出请求前一刻，提供方会向发起请求的 Agent 会话追加仅用于日志的 `web/openrouter-search-llm-request` 事件，其中包含已解析 endpoint 和不含密钥的精确 JSON 请求体。凭据预检仍留在提供方内部，并与调用方取消存在竞态；这两项关注点都不会扩展通用 Web seam 或凭据 seam。

默认挂载不会创建 Web 专用权限策略。`web_search` 在 bash／文件系统沙箱及审批预设之外执行，并遵循 `dsh-tool-web` 的现有约定。组合不挂载 `web_fetch` 或本地抓取提供方，因此默认配置不会允许模型自行选择任意 URL 进行抓取。已交付的 `workspace-write` 默认值只管辖文件修改；若产品采取受限网络策略，就需要添加 `tools/pre-execute` 策略或按能力限制网络访问，而不能暗示文件系统访问模式会管辖 Web 调用。

## 考虑过的替代方案

**仅挂载 `dsh-tool-web`。** 不予采纳：稳定的 schema 如果没有已注册提供方，每次默认调用都会失败。启用状态与后端可用性刻意分离，但已交付的默认配置必须提供其预期实现。

**从 `cordis.yml` 读取 `$DSH_HOME/.env`，或将其提升到 `process.env`。** 不予采纳：凭据提供方拥有该文件，环境变量值是只读覆盖；提升后存储的密钥将无法轮换，还会绕过经审计的密钥边界。

**在提供方加载时固定读取 `process.env.OPENROUTER_API_KEY`。** 不予采纳：Web Models 页面通过 `ctx.credentials` 写入密钥；产品文档规定的首次运行路径必须保证下一次操作无需重启即可生效。

**将 Web 工具保留在 `web.cordis.yml` 中。** 不予采纳：这会保留 TUI 与 Web／无头界面之间无法解释的工具清单差异。这些配置行并非界面特有，因此其唯一归属是 `base.cordis.yml`；[工具清单决策](2026-07-31-even-out-shipped-tool-rosters.md)记录了这一共享组合。

**提高 `dsh-tool-web` 的提供方无关超时。** 不予采纳：自定义提供方和部署有各自不同的延迟预期；这一部署预算应归已交付的 OpenRouter 组合所有。

**同时启用搜索和抓取。** 不予采纳：默认启用 `web_fetch` 会允许模型自行选择任意 URL，执行匿名出站 HTTP(S) 抓取。搜索负责发现信息；接受更广泛抓取范围的部署可以在覆盖层中选择启用 `dsh-web-fetch-http`，并将 `dsh-tool-web` 的 `fetch` 选项设为 `true`。

## 后果

每个已交付界面的原生模型请求都只会携带 `web_search` schema，以及仅用于搜索的提示词指引；Web／无头 Code Mode 通过 `run_code` 公开相同的搜索能力。该提示词要求模型使用返回的 snippet，且绝不会向模型提及已禁用的 `web_fetch` 工具。搜索会增加一次完整的辅助模型调用，并可能多次使用 server tool；发起会话的日志仍可精确重建其不含密钥的请求。默认配置会提供搜索结果 snippet 与来源元数据，但不支持任意页面抓取；需要抓取完整页面的部署必须自行选择启用抓取。Web 快照通道会启动已交付配置树，使用本地 Chat Completions fixture，经由真实 OpenRouter 提供方驱动一次回放的 `web_search` 调用，断言持久化的辅助请求与结构化结果，并固定最终浏览器呈现。TUI/Web 组合冒烟测试固定了共享的 `web_search` 清单及不提供 `web_fetch` 这一事实；构建后组合配置的转储固定了已交付的一分钟搜索预算；提供方测试固定缺失、已存储及已轮换凭据的行为，以及字面值与环境变量的兼容性。
