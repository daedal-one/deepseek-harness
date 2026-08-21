/** Client-safe payload vocabulary for graphical per-Agent model settings. */

import type { Branded } from '@deepseek-ai/dsh-brand'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The live Agent-model role directory gained or lost a visible target.
     * Consumers re-read the directory after this post-commit notification;
     * equivalent reference-count changes do not emit. Observer failures are
     * contained and cannot veto the registry mutation.
     * @mode emit
     */
    'agent-models/directory-updated'(): void
  }
}

/** Stable identity of one configurable Agent role. */
export type AgentModelTargetId = Branded<'AgentModelTargetId'>

/** Stored selection under one target's deployment-fixed provider route. */
export interface StoredAgentModelSelection {
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: string
}

/** One graphical model option under a deployment-fixed provider. */
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
  /** Deployment-fixed provider route for this target. */
  readonly provider: string
  /** Effective selection for the next Agent start. */
  readonly selection: StoredAgentModelSelection
  /** Deployment selection restored by reset. */
  readonly defaultSelection: StoredAgentModelSelection
  /** Whether the user settings layer owns this target's current selection. */
  readonly overridden: boolean
}

/** One provider catalog required by the visible Agent targets. */
export interface AgentModelCatalogView {
  /** Exact deployment provider route. */
  readonly provider: string
  /** Models currently served by this provider route. */
  readonly models: readonly AgentModelOption[]
}

/** Point-in-time Agent model directory and its provider catalogs. */
export interface AgentModelsSnapshot {
  /** Whether the current settings provider accepts writes. */
  readonly writable: boolean
  /** Monotonic revision of the raw Agent-model settings section. */
  readonly revision: number
  /** Main Agent first, then named contributions by label and id. */
  readonly targets: readonly AgentModelTargetView[]
  /** Distinct provider catalogs required by the visible targets. */
  readonly catalogs: readonly AgentModelCatalogView[]
}
