# @deepseek-ai/dsh-subagent-result-status-block

[English](README.md) | 中文

面向角色的一次性 subagent 完成结果校验。每个插件实例在 `ctx.subagents` 上注册一个具名校验器；[`dsh-tool-subagent`](../tool-subagent/README.md) 实例通过 `resultValidation` 选择它。未配置的委派工具不受影响。

`implementer-status` 检查从 Daedal 导入的完成字段（`Status`、`Confidence`、`Spec issues`、`Deviations`、`Files`、`Verification`、`Commit` 和 `Warnings`）。Guru 的 `PLAN` 与 `ADVERSARIAL` 报告使用独立的 verdict 协议，因此免除此检查。对于进程内子级，成功的 `write`、`edit` 和 `str_replace_editor` 事件会佐证 `Files:`；状态块漏报已修改路径时产生警告。

`review-verdict` 要求 `Verdict` 与 `Summary`，缺陷 verdict 还要求 `Defects`。对于进程内子级，缺陷条目中的文件和行号声明会与成功且持久化的 `read` 或 `read_image` 事件比较。该证据检查有意是单向的：shell 读取和远程提供方活动没有结构化文件系统事实，因此缺少匹配事件只会产生警告，绝不会删除或拒绝 review。

前台委派结果携带结构化警告，后台任务结果携带稳定文本。校验器自身失败会变成 `validator-failed`；子级输出始终保留。已配置但不存在的校验器会在启动子级前拒绝，因此拼错的策略不能静默关闭校验。

## 配置

| 键 | 含义 |
|---|---|
| `validator` | 委派工具选择的唯一注册名。 |
| `kind` | `implementer-status` 或 `review-verdict`。 |

## 模型体验

### 结果警告

#### 模型看到的内容

子级的正常最终文本；仅在需要时追加类似 `[subagent-result:missing-status-fields] ...` 的行。前台规范输出还携带警告的 `code`、`message` 和可选 JSON `details`。

#### Token 影响

有效结果不增加 token。无效结果会为每个检测到的问题增加一行有界文本，以及提供方产生的安全路径列表。

#### KV Cache 影响

仅追加。校验只改变新的委派结果，不修改更早的请求前缀。

## 已知限制与暂缓事项

- 结构化文件系统事件无法证明 shell、远程提供方或外部编辑器的读写。校验器只报告有持久事实支持的矛盾，不声称能完整重建活动。
- 状态块解析器用于兼容导入的角色提示词。新角色设计应使用现有 subagent `outputSchema` 能力，并仅把文本解析保留为兼容层。
