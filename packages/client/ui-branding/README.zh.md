# @deepseek-ai/dsh-client-ui-branding

[English](README.md) | 中文

浏览器品牌插件：持有应用外壳、空对话 hero、浏览器标题、favicon 和 Web App Manifest 所显示的用户可控产品名称与 logo。内置身份是小写名称 `the harness`，logo 未覆盖时使用鱼形标记。实时 `BrandingRuntime` 是所有已组装 React 表层读取的唯一来源；Host 侧还会把同一份设置投影进初始 index 响应与精确元数据路由，因此加载间隔和已安装应用不会退回到另一套品牌。

Host 注册 `ui-branding` settings namespace。`name` 是去除首尾空白后非空、最长 48 个字符的字符串。`logo` 可选，存储 PNG、JPEG、WebP、GIF 或 AVIF 内容的 base64 data URL，原始文件上限为 512 KiB。回环浏览器通过特权 settings API 编辑该 namespace，本地提供方将其存入 `$DSH_HOME/settings.yaml`；实时服务会乐观更新，在 settings 失效通知与重连时收敛，并在最新一次写入被拒后恢复持久值。远程浏览器无法访问该 API，因此其变更仅保留在进程内。该持久化生命周期沿用 [Host settings 支撑的 Web 偏好决策](../../../.agents/notes/implemented/bug-fix/2026-08-06-host-backed-web-preferences.md)。

General settings 行可编辑名称、上传或重置 logo，并显示当前标记。上传的 logo 会立即出现在侧边栏、空会话 hero、浏览器标签页与文档标题后缀中；重置任一字段会让该字段回到内置值。不接受外部 logo URL，因此渲染不会向图片主机泄露页面访问，也不依赖该主机持续可用。SVG 被排除，是因为 settings 值会跨越存储、HTML 与浏览器渲染路径；有上限的栅格格式允许列表使该值保持惰性，并让 Host 路由获得无歧义的媒体类型。

Host index 变换会以当前设置替换初始 `<title>` 与 favicon 链接。`/manifest.webmanifest` 返回一致的 `name`、`short_name` 与图标元数据；`/branding/logo` 提供解码后的上传内容，没有覆盖时则重定向到 `/favicon.svg`。两条精确路由都使用 `Cache-Control: no-store`，因此设置变更不会在中间缓存里留下陈旧的产品身份。完整身份表层与格式限制由[用户可控浏览器品牌决策](../../../.agents/notes/implemented/feature/2026-08-16-user-controlled-browser-branding.md)持有。

## 模型体验

无。品牌只改变浏览器呈现与安装元数据；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **上传 logo 会增大 settings 文档**：达到上限的文件经 base64 编码后约占 683 KiB，并通过 namespace settings API 传输；该上限约束了成本，但没有提供独立资产存储。
- **只接受栅格上传**：不支持 SVG、外部 URL 或动画格式转码。浏览器表层支持 GIF 动画时仍会播放。
- **远程浏览器编辑不会持久化**：特权 settings API 按设计仍仅限回环访问，因此远程品牌变更只在该浏览器进程内有效。
