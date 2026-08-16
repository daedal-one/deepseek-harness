# @deepseek-ai/dsh-agent-plane

[English](README.md) | 中文

供所有支持预设的界面共用的 profile 层。它将进程级服务保留在 `dsh-base` 中，禁用 base 中模型可见的 Consumer，并挂载一个 `dsh-agent-presets` 名册。每个运行器会在创建 Session 前解析所选预设，再把它挂载到新的 Agent 作用域中。

请将它放在 `@deepseek-ai/dsh-base` 之后、界面 bundle 之前：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-agent-plane",
        "@deepseek-ai/dsh-headless"
      ]
    }
  }
}
```

该层只负责组合。被禁用的行和由预设挂载的软件包各自拥有自己的运行时不变量。

## 模型体验

### 预设组装

#### 模型可见内容

所选 `agentPreset` 注册的提示词、工具、技能、委派 Consumer 与输出 guard。此 bundle 本身不增加文本或工具 schema。

#### Token 影响

无直接 token。所选预设拥有完整的模型可见贡献。

#### KV Cache 影响

无直接影响。切换预设会选择不同的常驻组装，因此也会得到不同的请求前缀。

## 已知限制与延期工作

- 自定义界面必须在创建 Agent 时调用共享预设组装辅助函数。仅靠 bundle 分层无法把常驻预设 scope 关联到 Agent。
- 预设挂载仍是进程内常驻代际；编辑后的组装适用于后续 Agent，而已经加入的 Agent 保留原代际。
