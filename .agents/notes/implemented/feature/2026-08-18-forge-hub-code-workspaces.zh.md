# Agent Note：Forge Hub Code Workspace

Status: implemented

[English](2026-08-18-forge-hub-code-workspaces.md) | 中文

## 问题

DeepSeek Harness Web 应用拥有本地 Workspace 注册表，而 Forge 拥有已注册的项目身份、仓库链接和应用投影。如果 Hub 直接嵌入普通 Web 应用却不连接这两个模型，就会暴露第二份项目列表：操作员可能在 frame 外选择一个 Forge 项目，却在 frame 内落到另一个最近使用的 Harness Workspace。让浏览器创建缺失路径还会把未经认证的展示参数变成项目供应权限。

## 决策

`dsh-forge-project-workspaces` 接受 Forge Hub 使用 bearer 认证发送的完整替换。它把 `ProjectId` 验证为 `PROJECT:<slug>`，派生托管路径 `/workspaces/forge/<slug>`，只在 checkout 不存在时物化关联的 Forgejo 仓库，并对账 Workspace 注册表的成员、标题和顺序。替换中缺失的条目只会失去注册记录；目录和 Session 日志仍可恢复。

浏览器 runtime 只把绝对 `?workspace=` 值视为初始选择意图。它会等待该精确路径出现在已注册 Workspace 基线中，打开或创建该 Workspace 的空白 Session，并且绝不会回退到另一个最近项目。Hub 在渲染 frame 前完成同步并提供选中的托管路径，因此项目选择仍是 Forge 投影，而对话行为仍是 Harness 原生行为。Forge 部署保留 Workspace 浏览器以访问托管 Session 历史，同时禁用目录接纳，并拒绝公开的 Workspace create、rename、delete 与 reorder RPC，防止操作员通过嵌入 origin 写入第二份目录。

仓库凭据通过子进程环境进入 Git，而不是进入 clone URL。替换请求会串行执行；现有 checkout 永远不会被 fetch 或 reset，因为保留正在进行的修改比自动镜像 Forgejo 更重要。

## 考虑过的替代方案

**让操作员在嵌入式侧栏中注册目录。** 此方案被否决，因为生成的列表无法与 Forge 项目一一对应，Harness-only Workspace 还可能看起来像 Forge 应用。

**把 Forge ProjectId 编码成 Harness WorkspaceId。** 此方案被否决，因为 WorkspaceId 是建立在规范路径上的持久生成身份。复用外部标识会把注册表的存储语义耦合到一个控制平面，并绕过其创建和恢复规则。

**让 Hub 基于 Forge session 协议重新实现对话 UI。** 此切片中否决该方案，因为 Harness 已经拥有成熟的交互式浏览器体验。Forge 继续保留用于持久编排的 harness-neutral runtime，而嵌入的 provider-native UI 仍是已登记的专业界面。

## 结果

Forge Web 部署拥有专用的认证目录路由和持久 Harness 状态。项目名册可从 Forge 重建，但工作目录会有意地在注销后保留，现有仓库也有意地不自动刷新。Web 进程仍以其挂载环境的权限执行；此决策不声称具备 sandbox、网络、凭据、生命周期或清理隔离。

聚焦的 host composition 测试覆盖认证、一一替换、稳定顺序、标题对账、目录保留和身份拒绝。客户端 runtime 测试覆盖绝对深链接解析、覆盖当前会话、精确目标选择，以及等待时不跨项目回退。
