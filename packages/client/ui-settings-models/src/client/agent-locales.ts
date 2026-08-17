/** Copy dictionaries for the per-Agent model settings page. */

/** English strings. */
export const agentEn = {
  nav: 'Agents',
  title: 'Agent models',
  intro: 'Choose the OpenRouter model and reasoning level used when each agent starts its next conversation.',
  provider: 'Provider',
  model: 'Model',
  reasoning: 'Reasoning',
  providerDefault: 'Provider default',
  apply: 'Apply',
  applying: 'Applying…',
  reset: 'Restore default',
  resetting: 'Restoring…',
  saved: 'Saved.',
  defaultTag: 'Deployment default',
  overrideTag: 'Customized',
  liveAgents: 'Agent roles',
  readOnly: 'Agent settings are read-only in this deployment.',
  loading: 'Loading agent models…',
  loadFailed: 'Agent models could not be loaded.',
  retry: 'Retry',
  stale: 'Agent settings changed elsewhere. Reload this page before applying again.',
} as const

/** Agent settings locale key. */
export type AgentModelsKey = keyof typeof agentEn

/** Chinese strings. */
export const agentZh: { [Key in AgentModelsKey]: string } = {
  nav: '智能体',
  title: '智能体模型',
  intro: '选择每个智能体下次开始会话时使用的 OpenRouter 模型与推理强度。',
  provider: '提供方',
  model: '模型',
  reasoning: '推理强度',
  providerDefault: '提供方默认值',
  apply: '保存',
  applying: '保存中…',
  reset: '恢复默认值',
  resetting: '恢复中…',
  saved: '已保存。',
  defaultTag: '部署默认值',
  overrideTag: '已自定义',
  liveAgents: '智能体角色',
  readOnly: '当前部署的智能体设置为只读。',
  loading: '正在加载智能体模型…',
  loadFailed: '无法加载智能体模型。',
  retry: '重试',
  stale: '智能体设置已在其他位置更改。重新加载此页后再保存。',
}
