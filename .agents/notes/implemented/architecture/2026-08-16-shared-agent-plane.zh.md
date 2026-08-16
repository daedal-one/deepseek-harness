# Agent Note: 面向所有支持预设界面的共享 Agent 平面

Status: implemented

[English](2026-08-16-shared-agent-plane.md) | 中文

## 问题

Web profile 自己维护由逐 Session 预设组装禁用的宿主行，而 headless profile 仍直接执行 base bundle 中面向模型的 Consumer。因此，一个预设只在 Web 界面描述完整的 Agent；同一预设经 headless 选择时，可能得到不同的提示词、工具注册表、压缩行为与委派界面。

## 决策

`dsh-agent-plane` 成为 `dsh-base` 与所有支持预设界面之间的必需 bundle 层。它禁用由预设替代的 base 面向模型行，并挂载预设名册。界面 bundle 只保留自身的传输或应用行为。

Agent 创建统一使用 `dsh-agent-presets` 拥有的组装辅助函数。该函数解析已选择或默认的预设，在 Agent 发布前把预设写入 Session header，并在 Agent factory 的 setup 窗口中完成挂载。Web `ApiProxy` 与 headless runner 调用此函数，不再分别重建这套顺序。

## 考虑过的替代方案

**继续由各界面 bundle 维护组装。** 拒绝，因为每个新界面都可能静默偏离，而且 profile manifest 无法呈现统一的所有权点。

**把所有 Agent Consumer 移入 base bundle。** 拒绝，因为进程全局 Consumer 无法表达逐 Session 预设选择，也无法隔离两套预设注册表。

## 后果

同一预设现在在 Web 与 headless 界面具有一致的模型可见组装。Profile manifest 显式声明共享层，因此配置 dump 与安装后备解析会展示真实顺序。希望支持预设选择的自定义界面必须包含 agent-plane bundle 并使用共享组装辅助函数；缺少任一项都属于不完整界面，而不是另一种预设运行时。

Agent-plane bundle 不选择 persona、模型或工具集；这些仍属于预设数据。界面特有的宿主服务继续位于预设之外，且仍可因部署而不同。

Headless 会禁用源模块 HMR，但仍保持 profile 与 home patch 文件实时生效。Launcher fallback 会轮询这两个精确配置路径；在 macOS 上，原生目录 watcher 可能在一次性任务启动前就超过较低的单进程文件描述符限制。
