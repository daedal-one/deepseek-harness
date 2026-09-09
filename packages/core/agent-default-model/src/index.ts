/**
 * Persistent model selection for the main Agent and named Agent contributors.
 *
 * @module @deepseek-ai/dsh-agent-default-model
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AgentOptions, ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AgentModelOption,
  AgentModelCatalogView,
  AgentModelsSnapshot,
  AgentModelTargetId,
  AgentModelTargetView,
  StoredAgentModelSelection,
} from './types.ts'

export type {
  AgentModelOption,
  AgentModelCatalogView,
  AgentModelsSnapshot,
  AgentModelTargetId,
  AgentModelTargetView,
  StoredAgentModelSelection,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Persistent deployment-owned model selections for main and named Agents. */
    agentModels: AgentModelConfig
  }
}

/**
 * Validate and brand one Agent model target id.
 * @param value - candidate stable id.
 * @returns validated Agent target id.
 */
export function agentModelTargetId(value: string): AgentModelTargetId {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)) {
    throw new TypeError(`agent model target id "${value}" must be lowercase kebab-case`)
  }
  return value as AgentModelTargetId
}

/** Main conversation Agent target. */
export const MAIN_AGENT_MODEL_TARGET = agentModelTargetId('main')

/**
 * Derive the stable main-Agent settings target for one preset route.
 * @param presetId - preset roster id owned by the deployment.
 * @returns preset-qualified main-Agent target id.
 */
export function presetAgentModelTargetId(presetId: string): AgentModelTargetId {
  return agentModelTargetId(`main-${presetId}`)
}

/** Settings namespace carrying per-Agent model selections. */
export const AGENT_MODELS_SETTINGS_NAMESPACE = 'agent-models'

/** Stored per-Agent model selections keyed by stable target id. */
export interface AgentModelsSettings {
  /** Complete user selections over registered deployment defaults. */
  agents: Record<string, StoredAgentModelSelection>
}

const storedSelection: z<StoredAgentModelSelection> = z.object({
  model: z.string().required(),
  reasoningEffort: z.string(),
})

/** Schema of the per-Agent model settings section. */
export const AGENT_MODELS_SETTINGS_SCHEMA: z<AgentModelsSettings> = z.object({
  agents: z.dict(storedSelection),
})

/** One deployment-owned main-Agent route assigned to a preset. */
export interface AgentModelPresetRoute {
  /** Provider route fixed for this preset's main Agent. */
  provider: string
  /** Main-Agent model id. */
  model: string
  /** Main-Agent reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: string
  /** Graphical label; defaults to the preset id followed by `main agent`. */
  label?: string
}

/** Composition entry for fallback and preset-specific main-Agent routes. */
export interface Config {
  /** Fallback provider route for presets without an explicit assignment. */
  provider: string
  /** Fallback main-Agent model id. */
  model: string
  /** Fallback main-Agent reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: string
  /** Preset ids mapped to deployment-owned main-Agent routes. */
  presets?: Record<string, AgentModelPresetRoute>
}

/** One deployment-owned named Agent contribution. */
export interface AgentModelTarget {
  /** Stable settings identity. */
  id: AgentModelTargetId
  /** Human-facing role name. */
  label: string
  /** Selection used when no user override exists; omission inherits the main deployment default. */
  defaultSelection?: ModelSelection
}

/** Registered target after its deployment default has been resolved. */
interface ResolvedAgentModelTarget extends AgentModelTarget {
  defaultSelection: ModelSelection
}

/** Compare the stable facts of two target contributions. */
function sameTarget(left: ResolvedAgentModelTarget, right: ResolvedAgentModelTarget): boolean {
  return left.id === right.id
    && left.label === right.label
    && left.defaultSelection.provider === right.defaultSelection.provider
    && left.defaultSelection.model === right.defaultSelection.model
    && left.defaultSelection.reasoningEffort === right.defaultSelection.reasoningEffort
}

/** Render a listener failure without trusting arbitrary string coercion. */
function renderThrown(value: unknown): string {
  try {
    return String(value)
  } catch {
    return '<unrenderable thrown value>'
  }
}

/** Convert a complete selection to its provider-free stored form. */
function stored(selection: ModelSelection): StoredAgentModelSelection {
  return {
    model: selection.model,
    ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: String(selection.reasoningEffort) },
  }
}

/** Rebuild the provider-owned selection consumed by Agent entry points. */
function selected(provider: string, value: StoredAgentModelSelection): ModelSelection {
  return {
    provider,
    model: value.model,
    ...value.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(value.reasoningEffort) },
  }
}

/** Settings descriptor for this service's namespace, when a provider is mounted. */
function ownDescriptor(ctx: Context): SettingsDescriptor | undefined {
  return ctx.get('settings')?.describe({ redactSecrets: true })
    .find(descriptor => descriptor.ns === AGENT_MODELS_SETTINGS_NAMESPACE)
}

/** Whether the raw user section contains one target override. */
function userOwns(descriptor: SettingsDescriptor | undefined, id: AgentModelTargetId): boolean {
  if (typeof descriptor?.user !== 'object' || descriptor.user === null) return false
  const agents = (descriptor.user as { agents?: unknown }).agents
  return typeof agents === 'object' && agents !== null && id in agents
}

/** Project exact adapter metadata into the graphical model vocabulary. */
function modelOption(model: LlmResolvedModelInfo): AgentModelOption {
  return {
    id: model.id,
    name: model.name,
    ...model.description === undefined ? {} : { description: model.description },
    reasoningEfforts: model.reasoning?.efforts.map(effort => ({
      id: String(effort.id),
      name: effort.name,
      ...effort.description === undefined ? {} : { description: effort.description },
    })) ?? [],
    ...model.reasoning?.defaultEffort === undefined
      ? {}
      : { defaultReasoningEffort: String(model.reasoning.defaultEffort) },
  }
}

interface CountedTarget {
  readonly target: ResolvedAgentModelTarget
  count: number
}

/**
 * Owns persistent Agent model selections and their lifecycle-safe directory.
 * Each target's provider route is fixed by composition; settings select only
 * a model and optional reasoning effort under that route.
 */
export class AgentModelConfig extends TypertRemoteService {
  static inject = ['llm']

  static Config: z<Config> = z.object({
    provider: z.string().required(),
    model: z.string().required(),
    reasoningEffort: z.string(),
    presets: z.dict(z.object({
      provider: z.string().required(),
      model: z.string().required(),
      reasoningEffort: z.string(),
      label: z.string().min(1),
    })).default({}),
  })

  private source: () => AgentModelsSettings
  private readonly targets = new Map<AgentModelTargetId, CountedTarget>()
  private readonly presetTargets = new Map<string, AgentModelTargetId>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'agentModels')
    const mainSelection: ModelSelection = {
      provider: config.provider,
      model: config.model,
      ...config.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: ReasoningEffortId(config.reasoningEffort) },
    }
    const entry: AgentModelsSettings = { agents: { [MAIN_AGENT_MODEL_TARGET]: stored(mainSelection) } }
    this.source = () => entry
    this.targets.set(MAIN_AGENT_MODEL_TARGET, {
      target: { id: MAIN_AGENT_MODEL_TARGET, label: 'Main agent', defaultSelection: mainSelection },
      count: 1,
    })
    for (const [presetId, route] of Object.entries(config.presets ?? {})) {
      const id = presetAgentModelTargetId(presetId)
      const selection: ModelSelection = {
        provider: route.provider,
        model: route.model,
        ...route.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: ReasoningEffortId(route.reasoningEffort) },
      }
      this.presetTargets.set(presetId, id)
      this.targets.set(id, {
        target: {
          id,
          label: route.label ?? `${presetId} main agent`,
          defaultSelection: selection,
        },
        count: 1,
      })
    }
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(ctx, AGENT_MODELS_SETTINGS_NAMESPACE, AGENT_MODELS_SETTINGS_SCHEMA, entry, {
        setSource: (current) => { this.source = current },
        onChange: () => {},
      })
    })
  }

  /** Notify directory observers without making their refresh work load-bearing. */
  private notifyDirectoryUpdated(): void {
    for (const callback of this.ctx.events.dispatch('emit', ['agent-models/directory-updated'])) {
      try {
        const returned: unknown = callback()
        void Promise.resolve(returned).catch((error: unknown) => {
          this.ctx.logger.warn(`agent-models/directory-updated listener rejected: ${renderThrown(error)}`)
        })
      } catch (error: unknown) {
        this.ctx.logger.warn(`agent-models/directory-updated listener threw: ${renderThrown(error)}`)
      }
    }
  }

  /**
   * Register one named Agent target. Equivalent registrations from several
   * Agent scopes coalesce; a conflicting definition fails before either can
   * silently win.
   * @param target - stable id, display label, and deployment default.
   * @returns idempotent disposer for this contribution.
   */
  registerTarget(target: AgentModelTarget): () => void {
    const mainDefault = this.targets.get(MAIN_AGENT_MODEL_TARGET)?.target.defaultSelection
    if (mainDefault === undefined) throw new Error('agent-models: main deployment default is unavailable')
    const resolved: ResolvedAgentModelTarget = {
      ...target,
      defaultSelection: { ...(target.defaultSelection ?? mainDefault) },
    }
    const existing = this.targets.get(target.id)
    if (existing !== undefined) {
      if (!sameTarget(existing.target, resolved)) {
        throw new Error(`agent-models: target "${String(target.id)}" has conflicting definitions`)
      }
      existing.count += 1
    } else {
      this.targets.set(target.id, { target: resolved, count: 1 })
      this.notifyDirectoryUpdated()
    }
    let active = true
    return () => {
      if (!active) return
      active = false
      const current = this.targets.get(target.id)
      if (current === undefined) return
      current.count -= 1
      if (current.count === 0) {
        this.targets.delete(target.id)
        this.notifyDirectoryUpdated()
      }
    }
  }

  /**
   * Read one registered target's current provider, model, and optional effort.
   * @param id - target to resolve; defaults to the main Agent.
   * @returns a detached complete selection.
   */
  currentSelection(id: AgentModelTargetId = MAIN_AGENT_MODEL_TARGET): ModelSelection {
    const target = this.targets.get(id)?.target
    if (target === undefined) throw new Error(`agent-models: unknown target "${String(id)}"`)
    const configured = this.source().agents[id]
    return configured === undefined
      ? { ...target.defaultSelection }
      : selected(target.defaultSelection.provider, configured)
  }

  /**
   * Read the current main-Agent route assigned to a preset.
   * @param presetId - effective preset id, or undefined without a roster.
   * @returns assigned selection, falling back to the deployment-wide main route.
   */
  mainSelection(presetId?: string): ModelSelection {
    return this.currentSelection(presetId === undefined
      ? MAIN_AGENT_MODEL_TARGET
      : this.presetTargets.get(presetId) ?? MAIN_AGENT_MODEL_TARGET)
  }

  /**
   * Apply one target's live selection over child options without disturbing
   * independent limits such as `maxTokens`.
   * @param id - registered named Agent target.
   * @param fallback - deployment options carrying non-selection fields.
   * @returns detached child options with the current selection.
   */
  optionsFor(id: AgentModelTargetId, fallback: AgentOptions = {}): AgentOptions {
    const { provider: _provider, model: _model, reasoningEffort: _reasoningEffort, ...rest } = fallback
    return { ...rest, ...this.currentSelection(id) }
  }

  /** Validate one requested selection against its target's fixed-provider route. */
  private async validateSelection(
    id: AgentModelTargetId,
    value: StoredAgentModelSelection,
  ): Promise<StoredAgentModelSelection> {
    const target = this.targets.get(id)?.target
    if (target === undefined) throw new Error(`agent-models: unknown target "${String(id)}"`)
    await this.ctx.llm.resolveCallConfig({
      provider: target.defaultSelection.provider,
      model: value.model,
      ...value.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: ReasoningEffortId(value.reasoningEffort) },
    })
    return { ...value }
  }

  /** Save one complete target override through the optional settings provider. */
  private async saveTarget(
    id: AgentModelTargetId,
    value: StoredAgentModelSelection,
    expectedRevision?: number,
  ): Promise<void> {
    const next = await this.validateSelection(id, value)
    const settings = this.ctx.get('settings')
    if (settings === undefined) throw new Error('agent-models: settings provider is unavailable')
    await settings.mutate(
      AGENT_MODELS_SETTINGS_NAMESPACE,
      [{ op: 'set', path: ['agents', String(id)], value: next }],
      expectedRevision,
    )
  }

  /**
   * Save a preset's main-Agent selection after a session-local model switch.
   * @param next - resolved selection accepted by the session entry point.
   * @param presetId - effective preset id, or undefined without a roster.
   * @returns fulfillment after the optional settings write settles.
   */
  async saveSelection(next: ModelSelection, presetId?: string): Promise<void> {
    const id = presetId === undefined
      ? MAIN_AGENT_MODEL_TARGET
      : this.presetTargets.get(presetId) ?? MAIN_AGENT_MODEL_TARGET
    const provider = this.targets.get(id)?.target.defaultSelection.provider
    if (provider === undefined) throw new Error(`agent-models: unknown target "${String(id)}"`)
    if (next.provider !== provider) {
      throw new Error(
        `agent-models: provider "${next.provider}" cannot replace target provider "${provider}"`,
      )
    }
    const settings = this.ctx.get('settings')
    if (settings === undefined) return
    await this.saveTarget(id, stored(next))
  }

  /**
   * Read the live target directory and its distinct provider catalogs.
   * @returns point-in-time graphical settings snapshot.
   */
  @Remote('list')
  async list(): Promise<AgentModelsSnapshot> {
    const descriptor = ownDescriptor(this.ctx)
    const targets = [...this.targets.values()]
      .map(({ target }): AgentModelTargetView => ({
        id: target.id,
        label: target.label,
        provider: target.defaultSelection.provider,
        selection: stored(this.currentSelection(target.id)),
        defaultSelection: stored(target.defaultSelection),
        overridden: userOwns(descriptor, target.id),
      }))
      .sort((left, right) => left.id === MAIN_AGENT_MODEL_TARGET
        ? -1
        : right.id === MAIN_AGENT_MODEL_TARGET
          ? 1
          : left.label.localeCompare(right.label) || String(left.id).localeCompare(String(right.id)))
    const providers = [...new Set(targets.map(target => target.provider))].sort()
    const catalogs = await Promise.all(providers.map(async (provider): Promise<AgentModelCatalogView> => {
      const listed = await this.ctx.llm.listModels(provider)
      const models = await Promise.all(listed.map(model =>
        this.ctx.llm.resolveModelInfo(provider, model.id).then(modelOption)))
      return { provider, models }
    }))
    return {
      writable: this.ctx.get('settings')?.writable === true,
      revision: descriptor?.revision ?? 0,
      targets,
      catalogs,
    }
  }

  /**
   * Persist one graphical Agent selection after exact model validation.
   * @param id - registered target id.
   * @param model - exact model id under the fixed provider.
   * @param reasoningEffort - exact supported effort, or omitted for provider behavior.
   * @param expectedRevision - settings revision read by the graphical page.
   * @returns refreshed directory and catalog.
   */
  @Remote('save')
  async save(
    id: AgentModelTargetId,
    model: string,
    reasoningEffort: string | undefined,
    expectedRevision: number,
  ): Promise<AgentModelsSnapshot> {
    await this.saveTarget(id, {
      model,
      ...reasoningEffort === undefined ? {} : { reasoningEffort },
    }, expectedRevision)
    return this.list()
  }

  /**
   * Remove one graphical override and restore its deployment default.
   * @param id - registered target id.
   * @param expectedRevision - settings revision read by the graphical page.
   * @returns refreshed directory and catalog.
   */
  @Remote('reset')
  async reset(id: AgentModelTargetId, expectedRevision: number): Promise<AgentModelsSnapshot> {
    if (!this.targets.has(id)) throw new Error(`agent-models: unknown target "${String(id)}"`)
    const settings = this.ctx.get('settings')
    if (settings === undefined) throw new Error('agent-models: settings provider is unavailable')
    await settings.mutate(
      AGENT_MODELS_SETTINGS_NAMESPACE,
      [{ op: 'unset', path: ['agents', String(id)] }],
      expectedRevision,
    )
    return this.list()
  }
}

export default AgentModelConfig
