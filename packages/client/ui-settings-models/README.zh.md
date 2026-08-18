# @deepseek-ai/dsh-client-ui-settings-models

[English](README.md) | 中文

为 Models 与 Agents Settings 页面提供图形化提供方管理，并提供首次运行的 OpenRouter 凭据步骤。客户端插件组合提供方目录、已脱敏 Settings 描述符、凭据与账户状态，以及生成的 `agentModels` Remote namespace；它绝不接收机密值。

## Models 页面

Models 页面编辑 `llm-pi-ai` 所有的路由。提供方行使用文字与底色 badge 显示凭据状态，不使用仅颜色指示。使用 API 密钥的提供方会显示只写密钥输入：输入值通过 `credentials.set` 存储，`settings.yaml` 只保留引用。OpenAI Codex 则显示原生 OpenAI 账户控件。登录会启动设备认证，显示提供方签发的代码与 OpenAI URL，轮询有界后台操作，并支持取消与登出；客户端只接收账户状态和认证元数据，从不接收 token。

OpenRouter 首次运行卡片与引导对话框精确定址到 `llm-pi-ai.providers.openrouter` profile。出现任何可用路由后，它们不再显示。添加卡片会提供已安装的 pi-ai 提供方，包括 OpenRouter、OpenAI 与 OpenAI Codex，也可声明已安装目录不认识的 OpenAI 兼容 gateway。

精选字段包括 endpoint，以及目录无法提供时的路由显示名、协议、模型列表与容量。**Fetch available models** 会询问草稿当前显示的 endpoint 并打开选择器；它不会自行写入。每次 Settings 编辑都是针对脱敏分节的路径变更，并携带卡片读取到的 revision，因此并发写方会产生冲突，而不是丢失变更。

## Agents 页面

Agents 页面为主 Agent 与当前通过 `ctx.agentModels` 注册的每个具名角色渲染一张卡片。Preset scope 新增或移除角色时，转发的目录通知会让已打开的页面重新获取数据，因此自定义角色无需重开 Settings 即可出现。所有卡片都使用部署组合层固定的提供方。每张卡片提供该提供方公布的精确模型与推理强度；保存前，Host 会校验该组合，再将其存到 `agent-models.agents.<id>`；恢复默认值则删除该角色的用户覆盖。

变更只在新 Agent 启动时生效。已存在的 Agent 与 Session 保留其日志中的选择。没有可写 Settings 的部署会显示同一份目录，但禁用控件。

## 引导

共享引导协调器先显示带版本的内部测试通知，随后在没有可用提供方路由时显示 OpenRouter 凭据对话框。对话框以仅凭据模式复用 Models 编辑器。Continue 会记录通知版本；Configure later 只跳过当前协调流程。

## 模型体验

无，因为这些页面只配置之后的请求，不添加任何模型可见内容。

#### KV Cache 影响

无直接影响。已更改的 Agent 选择在之后的 Agent 启动时生效，并由该 Agent 开始自己的提供方前缀。

## 已知限制与暂缓事项

- Agents 页面刻意不允许更改部署固定的提供方路由。
- 模型发现覆盖 OpenAI 兼容列表 endpoint；其他路由从已安装目录读取或手工输入。
- 没有可配置提供方地址的存活路由仍可用于请求路由，但在 Models 页面中没有编辑器。
