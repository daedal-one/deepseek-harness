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
}
