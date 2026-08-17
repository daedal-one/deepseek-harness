# Agent Note: 让用户控制浏览器品牌

Status: implemented

[English](2026-08-16-user-controlled-browser-branding.md) | 中文

## 问题

组装后的 Web 应用把 DeepSeek 鱼形字标与产品名称固定在多个相互独立的表层中。下游部署无法让浏览器应用显示为自己的产品，且只改一个渲染位置会导致侧边栏、空对话 hero、文档标题、favicon、加载间隔与安装元数据彼此不一致。固定的 DeepSeek 名称也描述了一个供应商，而不是本仓库提供的通用 agent harness。

## 决策

新的 `@deepseek-ai/dsh-client-ui-branding` 能力持有浏览器产品身份。内置名称是小写的 `the harness`，内置 logo 是现有鱼形标记。Host 注册带必填 `name` 字段与可选 `logo` 字段的 `ui-branding` settings namespace，API proxy 则将该 namespace 显式暴露给回环配置客户端。名称会去除首尾空白，不能为空，最长为 48 个字符。Logo 是 PNG、JPEG、WebP、GIF 或 AVIF 文件的 base64 data URL，编码前文件不得超过 512 KiB。

浏览器插件提供一份由共享 settings-scope 生命周期支撑的可观察 `BrandingRuntime`。General settings 行通过该服务写入，并显示实时预览。侧边栏、空对话 hero、文档标题、加载标题与 favicon 都消费同一 runtime，而不是接收复制的品牌 props 或各自读取 settings 文档。重置字段会取消其持久覆盖，因此默认值仍由 schema 与服务定义，而不会复制进用户配置。

Host 侧会在每份 index 响应到达浏览器前进行变换，以当前设置替换初始标题与 favicon。它还持有精确且不可缓存的 `/manifest.webmanifest` 与 `/branding/logo` 路由。Manifest 从同一份设置派生应用名称与图标。Logo 路由解码已存储的栅格图片，没有上传时则重定向到内置 favicon。这些 Host 投影覆盖客户端插件激活前的间隔，以及不运行 React 应用的浏览器消费方。

## 曾考虑的替代方案

**保留 DeepSeek 作为默认值，只允许自定义标签。** 本仓库是通用 harness，模型提供方可以单独配置。继续把供应商名称当作产品身份，会保留本功能本想消除的不匹配。

**只暴露部署期 Cordis 配置。** 这能让组合包作者重命名一个发行版，却不能让用户控制身份；一旦后来加入编辑器，它还会在持久 settings 之外建立第二个权威来源。

**存储外部 logo URL。** 浏览器渲染会向远程图片主机泄露 harness 的使用情况，需要网络可用，并让持久设置依赖可变的外部内容。存储有上限的图片字节，使渲染保持本地且可重复。

**接受 SVG 上传。** SVG 可以引用外部资源，且相比产品标记所需的栅格格式具有更大的主动内容表面。栅格允许列表让存储值在 settings、HTML、favicon 与 HTTP 响应路径中保持惰性。

**只更新 React 字标。** 加载文档、浏览器标签页、已安装应用元数据与空会话状态仍会保留陈旧身份。由同一个 settings owner 同时提供 Host 与浏览器投影，可以让这些消费方保持一致。

## 后果

浏览器应用现在无需用户配置就会将自身标识为 `the harness`。回环用户可以只改一次名称与 logo，让选择通过 `$DSH_HOME/settings.yaml`、重新加载与端口变化保持持久。远程浏览器保留进程局部行为，因为特权 settings API 仍仅限回环访问。

每个可见消费方与浏览器元数据消费方都读取同一个功能所属来源，而 ui-primitives 只持有纯 `BrandLogo` 渲染器与内置回落标记。默认 favicon 仍是开发与回落路由使用的静态资产，而不是第二个实时品牌权威。

达到上限的 logo 在 YAML settings 值与 settings API payload 中会膨胀到约 683 KiB。512 KiB 源文件上限约束了该成本，而无需引入资产存储、生命周期或垃圾回收政策。浏览器接受动画 GIF 时仍会播放；本功能不对上传内容进行转码。
