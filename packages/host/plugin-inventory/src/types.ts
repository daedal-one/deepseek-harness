import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable Loader-tree identity of one configured plugin entry. */
export type PluginEntryId = Branded<'PluginEntryId'>

/** Lifecycle state of an entry's root Fiber, or null when it has no live root Fiber. */
export type PluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/** Display metadata read from the package manifest that owns a Loader entry. */
export interface PluginPackageMetadata {
  /** Declared package author, or null when the manifest provides none. */
  readonly author: string | null
  /** Declared package description, or null when the manifest provides none. */
  readonly description: string | null
  /** Declared package version, or null when the manifest provides none. */
  readonly version: string | null
}

/** One non-group Loader entry exposed to trusted clients. */
export interface PluginInventoryEntry extends PluginPackageMetadata {
  readonly entryId: PluginEntryId
  /** Exact module specifier imported by the Loader entry. */
  readonly moduleName: string
  /** Effective Loader enablement, including disabled ancestor groups. */
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
}

/** Point-in-time inventory returned by the plugin inventory Remote. */
export interface PluginInventorySnapshot {
  readonly entries: readonly PluginInventoryEntry[]
}
