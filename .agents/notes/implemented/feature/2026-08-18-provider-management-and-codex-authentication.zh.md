# Agent Note: 提供方管理与 Codex 认证

Status: implemented

[English](2026-08-18-provider-management-and-codex-authentication.md) | 中文

## 问题

即使没有活跃路由，可配置提供方目录也必须描述可供添加的提供方。当用户替换组合提供的模型目录时，提供方设置同样必须保持可用。用户层的 `models` 列表与继承的 `modelAliases` 或 `modelOverrides` 递归合并后会使整个设置分节失效，进而撤下提供方目录，使 OpenRouter 等活跃路由失去管理行。

OpenAI 提供两种认证方式不同的产品。公开 OpenAI API 使用 API 密钥；Codex 后端则使用 OpenAI 账户、会过期的 OAuth 访问凭据、刷新 token 轮换，以及原生 Responses 请求中的账户标识符。若把 Codex 当作 API 密钥形式的路由，要么会把会过期的 token 暴露到设置中，要么无法解决刷新与登出的竞态。

## 决策

`LlmRuntime` 在适配器注册和可配置提供方注册之外，持有提供方无关的认证注册表。适配器按提供方和方法注册 `LlmProviderAuthenticator`。运行时提供账户状态查询、以有界后台操作启动登录、传递提供方签发的设备认证元数据、支持取消，并在登出或注册 dispose（资源释放）前等待对应登录完全结束。运行时最多保留 64 条终态操作快照，且从不承载账户凭据。

可配置提供方目录携带认证方法名称。Host 通过独立查询提供账户状态：`llm.providers` 继续安全地服务普通模型选择，而 `llm.providerAuthState`、登录、操作状态、取消和登出属于仅限 loopback 的配置面方法。协议只返回布尔值、设备代码、验证 URL 和诊断信息；token 永远不会进入客户端响应。

`dsh-llm-pi-ai` 以已安装的 pi-ai 提供方定义作为提供方来源。使用 OpenAI API 密钥的路由是 `openai`。OpenAI Codex 使用 `openai-codex` 路由、pi-ai 原生 `openai-codex-responses` 实现及其设备代码 OAuth 实现。Models 页面同时提供这两条路由；只有存在 API 密钥方法时才显示 API 密钥编辑器，并为 Codex 提供明确的登录、取消、状态和登出控件。

### 凭据所有权与生命周期

`HarnessPiCredentialStore` 把 pi-ai 凭据记录序列化到 `ctx.credentials` 持有的提供方专用内部引用中。设置文档既不包含 OAuth 记录，也不包含需要用户管理的引用。提供方请求与 pi-ai 刷新流程读取同一存储，因此刷新后的凭据无需重建配置即可用于下一次请求。

`CredentialProvider.modify` 是共享的原子读改写操作。提供方在异步更新回调期间持续持有存储事务；`undefined` 保留当前值，`unset` 仍是显式删除操作。本地提供方重新读取持久文档后，在跨进程写锁下执行该操作。因此，并发 token 刷新会彼此串行；登出会等待待处理登录完成后再删除记录，使延迟成功的登录无法恢复该记录。

### 分层提供方 profile

非空的用户 `models` 列表代表该路由完整的模型目录选择。它的优先级高于所有配置层的 `modelAliases` 和 `modelOverrides`。解析该路由时，系统会忽略继承字段，而不会把它们当作同层互相矛盾的声明。没有替换列表时，别名与覆写保留既有校验和增量语义。

## 考虑过的替代方案

**在 harness 中实现 OpenAI 或 Codex HTTP 客户端。** 不予采纳，因为 pi-ai 已经持有 OpenAI Responses 和 Codex Responses 传输、模型目录、设备认证、请求压缩、账户请求头构造及刷新行为。第二套实现会重复提供方协议代码，并逐渐偏离已安装目录。

**把 OAuth token 存入设置，或通过 Models 客户端暴露。** 不予采纳，因为设置可同步且可远程描述，浏览器客户端也不需要凭据值。凭据服务已经持有秘密持久化与失效通知职责。

**通过 `llm.providers` 返回账户状态。** 不予采纳，因为提供方与模型发现有意向受信任 LAN 客户端开放，而已存储账户状态属于凭据侦察信息。独立且仅限 loopback 的查询可以保留普通目录协议。

**刷新时分别读取和写入凭据。** 不予采纳，因为两个刷新操作可能从同一个陈旧 token 推导替换值，登出也可能与延迟完成的登录产生竞态。原子修改加生命周期等待可以使持久化结果保持确定。

**当组合提供别名或覆写时拒绝用户模型列表。** 不予采纳，因为设置递归分层会让这些字段共存，但用户列表表达的是完整替换选择。明确赋予列表更高优先级，无需给通用设置增加删除语法，也能保留配置所有权。

## 后果

OpenRouter、OpenAI、OpenAI Codex 和其他可管理的已安装 pi-ai 提供方在激活前仍保持可见，并可通过 Models 页面添加或移除。OpenAI Codex 请求通过原生传输使用已存储账户，其中包括 token 刷新，且不会把凭据放入设置或协议。

交互式 OAuth 支持有意仅覆盖 OpenAI Codex；其他提供方要等到其 pi-ai prompt 类型具有对应产品控件后才会开放。提供方无关的运行时可以承载这些实现，无需再次重做生命周期或协议设计。

提供方管理覆盖包括分层目录解析、并发持久修改、登录取消与资源释放、Host 序列化与 loopback 限制、Models 控件，以及针对本地 Responses endpoint 的原生 Codex 请求；该请求会校验认证请求头与账户请求头。
