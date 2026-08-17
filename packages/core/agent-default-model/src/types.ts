/** Client-safe payload vocabulary for graphical per-Agent model settings. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity of one configurable Agent role. */
export type AgentModelTargetId = Branded<'AgentModelTargetId'>

/** Stored selection under the deployment-fixed provider route. */
export interface StoredAgentModelSelection {
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: string
}

/** One graphical model option under the deployment-fixed provider. */
export interface AgentModelOption {
  /** Exact provider request id. */
  readonly id: string
  /** Human-facing model name. */
  readonly name: string
  /** Optional model distinction. */
  readonly description?: string
  /** Adapter-supported reasoning efforts in display order. */
  readonly reasoningEfforts: readonly {
    /** Exact effort id accepted by the adapter. */
    readonly id: string
    /** Human-facing effort name. */
    readonly name: string
    /** Optional effort distinction. */
    readonly description?: string
  }[]
  /** Adapter-configured default effort, or provider behavior when absent. */
  readonly defaultReasoningEffort?: string
}

/** One Agent row exposed to graphical configuration. */
export interface AgentModelTargetView {
  /** Stable Agent role identity. */
  readonly id: AgentModelTargetId
  /** Human-facing Agent role name. */
  readonly label: string
  /** Effective selection for the next Agent start. */
  readonly selection: StoredAgentModelSelection
  /** Deployment selection restored by reset. */
  readonly defaultSelection: StoredAgentModelSelection
  /** Whether the user settings layer owns this target's current selection. */
  readonly overridden: boolean
}

/** Point-in-time Agent model directory and fixed-provider catalog. */
export interface AgentModelsSnapshot {
  /** Deployment-fixed provider route. */
  readonly provider: string
  /** Whether the current settings provider accepts writes. */
  readonly writable: boolean
  /** Monotonic revision of the raw Agent-model settings section. */
  readonly revision: number
  /** Main Agent first, then named contributions by label and id. */
  readonly targets: readonly AgentModelTargetView[]
  /** Models currently served by the fixed provider route. */
  readonly models: readonly AgentModelOption[]
}
