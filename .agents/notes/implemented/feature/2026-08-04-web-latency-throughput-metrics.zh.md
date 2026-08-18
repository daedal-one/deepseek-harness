# Agent Note: Web 轮次与窗口级延迟/吞吐指标

Status: implemented

[English](2026-08-04-web-latency-throughput-metrics.md) | 中文

## 问题

Web 聊天已经记录了逐步骤的 LLM（大语言模型）计时（`stepStartTime`／`firstTokenTime`／`completedTime`）和逐步骤 usage，trajectory 视图也按步骤展示它们，但聊天界面既回答不了「这一轮响应有多快」，也回答不了「这个会话跑得有多快」：assistant 页脚只显示轮次实际耗时，统计行也只折算墙钟时间总量。

## 决策

`ui-conversation` 包内的折叠逻辑 `chat/turn-metrics.ts` 是从 assistant 节点推导延迟／输出速率读数的唯一位置。`assistantStepReading` 把一个节点转成一次步骤读数：TTFT（首 token 延迟）需要 `stepStartTime` 与 `firstTokenTime` 同时存在，请求时长需要 `stepStartTime` 与 `completedTime`，负时长钳制为零，输出 token 数只在不可信的 `usage` 值有限且非负时才采纳。`deriveTurnMetrics` 按轮次折叠读数：编号最小的步骤拥有该轮次的 TTFT 槽位，输出速率用「同时携带两者的那些步骤」的输出 token 总和除以完整请求时长总和，因此缺采样的步骤直接退出而不是让比值失真；两个数字都没有的轮次不产生条目。[缓冲流输出速率决策](../bug-fix/2026-08-17-buffered-stream-output-rate.md)负责定义完整请求分母。

assistant 页脚把读数追加到既有 hover 显示的时间附属元素中、`用时` 之后，形如 `首 token {s}秒 · {tps} tok/s`，未记录的数字各自省略。ChatView 仅在该轮次的 `turnTimings` 条目带有 `endTime` 时才显示读数：已加载窗口是日志的连续后缀，因此窗口内已结算的轮次必然带着它的全部步骤，首步 TTFT 是真实值而非窗口截断的产物。`formatLatencySeconds` 不带单位，各语言模板各自拥有秒后缀（`TTFT {seconds}s`／`首 token {seconds}秒`）。

统计行在其无单元窗口回退中复用同一份步骤读数：`deriveStats` 累计 TTFT 总和／计数与完整请求时长／输出 token 数，在 LLM／工具墙钟时间旁渲染经 `conversation` locale 命名空间本地化的延迟／输出速率分组（中文为 `首 token 平均 … · … tok/s`）。轮次计数、步骤计数、耗时、缓存与 token 各项的标签也使用同一命名空间。已组合的 Web 应用从[全会话数字决策](../bug-fix/2026-08-12-full-session-turn-step-counts.md)描述的持久 `sessionStats` 投影读取这些数字；token 账目仍归 token-meter 投影。

## 考虑过的替代方案

**让统计行保持窗口作用域。** [全会话数字决策](../bug-fix/2026-08-12-full-session-turn-step-counts.md)否决该口径，因为分页会改变每个已显示的聚合值。包内折叠仅供未组合 `sessionStats` 的装配回退。

**逐步骤页脚附属元素。** 让每条 assistant 消息显示自己的 TTFT，会给轮次中段的叙述节点挂上附属元素，而页脚设计刻意让它们保持无 chrome；trajectory 视图已经暴露逐步骤计时细节。

**用节点是否在场而非 `turn/end` 计时做页脚门控。** 直接渲染碰巧加载到的步骤，会展示一个貌似合理、实为分页后「首个已加载步骤」的 TTFT。`endTime` 门控加上后缀窗口不变量，使显示的数字要么是该轮次真实的首步延迟，要么什么都不显示。

## 后果

窗口内已结算轮次的页脚在 hover 时于实际耗时之后显示 `首 token`／`tok/s`，统计行在墙钟时间旁以本地化标签显示全会话平均延迟与端到端输出速率。指标以省略的方式退化：没有计时或 usage 采样的提供方或步骤只是丢掉对应数字，而不会渲染成零。未组合 `sessionStats` 的装配保留文档所述的窗口作用域回退。

两个读数都来自实测墙钟时间，因此都不可复现。Web aria 预期输出在既有的 `{{duration}}` 之外把吞吐归一化为 `{{throughput}}`；页脚的装饰性分隔符两侧保留空格——没有它们，这些读数会连成一整串无障碍文本（`Ran for 13sTTFT 0.2s12 tok/s`），既让屏幕阅读器失去读数之间的边界，也让 `{{duration}}` 失去它赖以匹配的词边界。
