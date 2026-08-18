# `@deepseek-ai/dsh-forge-project-workspaces`

[English](README.md) | 中文

这个 Web host 插件接收 Forge Hub 经过认证的项目目录，并将其对账到 Harness Workspace 注册表。Forge 始终是项目身份和仓库归属的权威；Harness 只保存派生的目录注册记录和会话。

## 运行时约定

`PUT /forge/v1/projects/sync` 替换完整的托管目录。每一行都必须携带 `project_id: PROJECT:<slug>`、相同且经过验证的 slug、显示标题，以及可选的 `owner/repository` Forgejo 名称。该路由创建或复用 `/workspaces/forge/<slug>`，只在目录中没有 Git checkout 时克隆指定仓库，注册路径，恢复 Forge 的顺序和标题，并注销替换数据中缺失的托管条目。注销绝不会删除目录或 Session 日志。

Bearer token 保护替换路由。仓库凭据只通过子进程环境进入 `git clone`，绝不进入 URL 或响应。并发替换会串行执行；部分物化失败会返回错误，后续相同请求可幂等地对账剩余状态。

Forge 部署通过已发布的 DeepSeek Harness 镜像提供此包，并将它挂载到 Web profile 旁边。Hub 使用客户端 runtime 的精确 `?workspace=` 深链接选择已对账项目。Workspace 浏览器会保留以访问托管 Session 历史，但目录接纳被禁用，公开的 create、rename、delete 与 reorder RPC 也会被拒绝。因此，这个经过认证的替换接口仍是向操作员暴露的唯一项目目录写入方。

## 模型体验

无，因为 host 侧目录对账器和浏览器选择输入均不注册提示词、工具、消息或会话事件。

#### KV Cache 影响

无。该包从不改变模型请求前缀。

## 已知限制与暂缓事项

- **Web 进程在已挂载的 Workspace 执行环境中运行**——本插件不提供文件系统、进程、网络、凭据、生命周期或清理隔离。该后续安全边界归 Forge executor provider 所有。
- **现有仓库不会刷新**——对账会保留本地修改和分支，对已有 `.git` 目录不做处理。
- **已移除的目录会保留**——替换只删除 Harness 注册记录，避免目录数据中的意外遗漏删除源码或 Session 数据。
