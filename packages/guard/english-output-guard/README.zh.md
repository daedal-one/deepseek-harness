# @deepseek-ai/dsh-english-output-guard

[English](README.md) | 中文

这是一个作用于指定范围的输出策略，用于所选模型路由可能偏移为汉字文本的部署。它向指定范围的系统提示词加入英文输出指令，并包装 `llm/stream`；辅助调用和未列入 `targets` 的路由会立即委派，而目标 agent loop（智能体循环）成功响应会缓冲到结束状态明确为止。错误和已中止响应会逐字节回放。没有大量未保护汉字的成功响应也会逐字节回放，包括提供方 `replayState`。

## 配置

所有因部署而异的选择都是必填项；无效、重复、空白、非正数或越界值会在插件加载时快速失败。

```yaml
- id: english-output-guard
  name: '@deepseek-ai/dsh-english-output-guard'
  config:
    targets:
      - provider: openrouter
        model: deepseek/deepseek-v4-flash-0731:nitro
    translator:
      provider: openrouter
      model: moonshotai/kimi-k2.7-code
    hanMinChars: 2
    hanRatio: 0.2
    maxTranslationInputChars: 32000
    maxOutputTokens: 4096
    timeoutMs: 30000
    failureMode: block
    translationNotice: none
```

`targets` 会在由 `isAgentLoopRequest` 标记的请求上比较精确的 `{provider, model}` 对；`sessionId` 和 `purpose` 不能证明所有权。移除受保护片段后，`hanMinChars` 和 `hanRatio` 必须同时达到阈值。翻译失败时，`failureMode: preserve` 回放原始成功流；`block` 会把每个受影响文本块替换为 `English output enforcement failed. The non-English prose was withheld.`。取消始终保留原文，并让 agent loop 的中止结果生效。`translationNotice: append` 会把 `[Translated to English.]` 添加到第一个发生变化的文本块。

## 缓冲和翻译

guard 只翻译 `text` 和 `reasoning` 块。围栏代码、行内代码、Markdown 链接目标、原始 URL、文件和路径引用、命令标志以及类似标识符的片段会在辅助请求前替换为无冲突占位符，并且必须各自原样返回一次。工具调用 id、名称、原始 JSON 参数及其他所有结构化块绝不进入翻译。翻译模型通过 `ctx.llm` 接收一次严格 JSON 请求，并受所配置的路由、输出上限和截止时间约束；该请求会被明确排除在递归拦截之外。

发生变化的响应会按原始块顺序发出一条规范分片流，随后附上原始 token 用量和结束原因。提供方 `replayState` 会被省略，因为它描述的是不同字节。翻译输出必须是严格 JSON，只能包含预期的块索引和类型、非空字符串、完整占位符，不得保留大量未保护汉字或额外字段。

## 持久审计

翻译模型分发前，`english-output/translation-request` 会记录打开的轮次和步骤、目标与翻译路由、精确系统提示词、消息、输出上限及受影响块的原始内容。`english-output/translation-result` 会记录 `translated`、`blocked` 或 `preserved`、受影响索引和受限的失败代码。这些是仅用于日志的事件：原始偏移文本绝不会成为 `assistant/chunk` 或 `assistant/message`；接受后的流仍是唯一规范 UI 与模型历史。包不变量要求每一对审计事件位于同一个打开步骤内，并要求 `translated` 或 `blocked` 结算后存在规范助手消息，除非该轮次中止。

dispose（资源释放）会中止插件拥有的全部翻译请求，并在完成前等待它们结算。对于目标偏移响应，缓冲会把完整主响应时间和翻译时间都加到首个可见输出的延迟中；非目标、失败、已中止和无偏移流不会进行辅助调用。

## 模型体验

### 指定范围的英文策略

#### 模型看到的内容

插件注册范围内的每个请求都包含以下策略。

##### 英文策略段落

```markdown
Write all explanatory text and reasoning in English. Keep code, commands, identifiers, paths, URLs, tool names, tool arguments, and quoted source material unchanged.
```

#### Token 影响

插件挂载范围内会增加固定且保留的系统提示词 token。

#### KV Cache 影响

指定范围的清单和策略文本不变时，前缀保持稳定。

### 条件翻译请求

#### 模型看到的内容

翻译模型会看到固定的严格 JSON 指令和一条受上限约束的 DATA 消息，其中只包含受影响且已占位处理的文本块。对话模型只会看到接受后的英文块或配置的失败文本，绝不会看到辅助请求。

#### Token 影响

这是由条件触发的 token 开销，并受 `maxTranslationInputChars`、`maxOutputTokens` 和所选块集合约束。即使执行策略阻止了原始主响应，该响应也已经产生费用。

#### KV Cache 影响

辅助请求独立于对话缓存。发生变化的助手响应会替换模型可见历史末尾的提供方字节，并省略对应 replay 状态；此前的对话前缀保持不变。

## 已知限制与暂缓事项

- **缓冲式呈现** — 目标偏移无法增量流式展示，因为必须先确定结束结果和完整受保护片段集合，接受后的分片才能进入持久日志。
- **仅由汉字触发** — 其他非英文文字不会触发翻译。
- **文本启发式规则** — 没有标记的引文可被翻译；只有明确结构化的片段会受保护。
- **没有翻译回放缓存** — 恢复的会话会使用已接受的助手消息，但被中断的请求无法复用已经完成却未进入规范流的辅助翻译。
