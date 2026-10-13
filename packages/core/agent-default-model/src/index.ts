/**
 * Persistent model selection for the main Agent and named Agent contributors.
 *
 * @module @deepseek-ai/dsh-agent-default-model
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AgentOptions, ModelSelection } from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider, CredentialRef } from '@deepseek-ai/dsh-credentials'
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

/** Reference grammar of the credential seam's {@link CredentialRef}: a POSIX shell identifier. */
const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** One deployment-owned alternate main-Agent route selected by its own credential's presence. */
export interface AgentModelFallbackRoute {
  /** Provider route serving this fallback. */
  provider: string
  /** Model id requested through that provider. */
  model: string
  /** Reasoning effort on this route, or provider/default behavior when absent. */
  reasoningEffort?: string
  /** Credential reference whose presence selects this route. */
  credentialRef: string
}

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
  /**
   * Credential reference the primary route's adapter resolves. Declaring it
   * together with {@link Config.fallbacks} arms credential-aware selection for
   * the deployment-wide main route; without it the primary route always wins.
   */
  credentialRef?: string
  /**
   * Alternate main-Agent routes in preference order, each keyed on its own
   * credential's presence. While the primary credential does not resolve, the
   * first entry whose reference does replaces the primary route.
   */
  fallbacks?: AgentModelFallbackRoute[]
  /** Preset ids mapped to deployment-owned main-Agent routes. */
  presets?: Record<string, AgentModelPresetRoute>
}

/** One resolved fallback route and the reference that selects it. */
interface ResolvedFallbackRoute {
  /** Selection used while this fallback is selected. */
  selection: ModelSelection
  /** Reference whose presence selects this route. */
  credentialRef: CredentialRef
}

/** Credential-aware main-route selection resolved from validated plugin config. */
interface ResolvedCredentialRoutes {
  /** Reference the primary route's adapter resolves. */
  primary: CredentialRef
  /** Declared alternate routes in preference order. */
  fallbacks: readonly ResolvedFallbackRoute[]
}

/**
 * Build the complete selection one deployment route names.
 * @param route - provider, model, and optional effort of a main-Agent route.
 * @returns the provider-owned selection Agent entry points consume.
 */
function routeSelection(route: { provider: string; model: string; reasoningEffort?: string }): ModelSelection {
  return {
    provider: route.provider,
    model: route.model,
    ...route.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(route.reasoningEffort) },
  }
}

/**
 * Validate the declared credential-aware route selection and brand its references.
 * @param config - plugin config validated against this plugin's schema.
 * @returns the primary reference and declared fallbacks, or undefined while the mechanism is not declared.
 * @throws Error when only one half of the primary/fallback declaration is present.
 */
function resolveCredentialRoutes(config: Config): ResolvedCredentialRoutes | undefined {
  const declared = config.fallbacks ?? []
  if (config.credentialRef === undefined) {
    if (declared.length === 0) return undefined
    throw new Error('agent-default-model: fallbacks require the primary route\'s credentialRef')
  }
  if (declared.length === 0) {
    throw new Error('agent-default-model: credentialRef requires at least one fallback route')
  }
  return {
    primary: credentialRef(config.credentialRef),
    fallbacks: declared.map(route => ({
      selection: routeSelection(route),
      credentialRef: credentialRef(route.credentialRef),
    })),
  }
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
    credentialRef: z.string().pattern(CREDENTIAL_REF_PATTERN),
    fallbacks: z.array(z.object({
      provider: z.string().required(),
      model: z.string().required(),
      reasoningEffort: z.string(),
      credentialRef: z.string().pattern(CREDENTIAL_REF_PATTERN).required(),
    })),
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
  /** Reference the primary main route's adapter resolves, when the mechanism is armed. */
  private readonly primaryCredentialRef: CredentialRef | undefined
  /** Declared alternate main routes in preference order. */
  private readonly fallbackRoutes: readonly ResolvedFallbackRoute[]
  /**
   * References the last completed presence read found configured. Empty until
   * such a read settles, and empty forever without a credentials service, so
   * an unread credential plane leaves the primary route in place.
   */
  private presence: ReadonlySet<CredentialRef> = new Set()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'agentModels')
    const mainSelection = routeSelection(config)
    const credentialRoutes = resolveCredentialRoutes(config)
    this.primaryCredentialRef = credentialRoutes?.primary
    this.fallbackRoutes = credentialRoutes?.fallbacks ?? []
    const entry: AgentModelsSettings = { agents: { [MAIN_AGENT_MODEL_TARGET]: stored(mainSelection) } }
    this.source = () => entry
    this.targets.set(MAIN_AGENT_MODEL_TARGET, {
      target: { id: MAIN_AGENT_MODEL_TARGET, label: 'Main agent', defaultSelection: mainSelection },
      count: 1,
    })
    for (const [presetId, route] of Object.entries(config.presets ?? {})) {
      const id = presetAgentModelTargetId(presetId)
      const selection = routeSelection(route)
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
    if (credentialRoutes !== undefined) {
      this.watchCredentialPresence(ctx, [
        credentialRoutes.primary,
        ...credentialRoutes.fallbacks.map(route => route.credentialRef),
      ])
    }
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(ctx, AGENT_MODELS_SETTINGS_NAMESPACE, AGENT_MODELS_SETTINGS_SCHEMA, entry, {
        setSource: (current) => { this.source = current },
        onChange: () => {},
      })
    })
  }

  /**
   * Track the declared references' presence for as long as a credentials
   * service is mounted. Presence comes from `describe`, which reports a
   * reference without returning its value, and is re-read after every
   * committed reference change so a key stored from the Models page reaches
   * the next Agent creation.
   * @param ctx - plugin context carrying the optional credentials service.
   * @param refs - primary and fallback references whose presence decides the route.
   */
  private watchCredentialPresence(ctx: Context, refs: readonly CredentialRef[]): void {
    ctx.inject(['credentials'], (credentialsCtx) => {
      const credentials = credentialsCtx.credentials
      const read = (): void => {
        void this.readPresence(credentials, refs).catch((error: unknown) => {
          credentialsCtx.logger.warn(`agent-models: credential presence read failed: ${renderThrown(error)}`)
        })
      }
      read()
      credentialsCtx.on('credentials/reference-updated', read)
    })
  }

  /**
   * Replace the observed reference set from the mounted credential plane; a
   * failed read leaves the previous observation in place.
   * @param credentials - mounted credential provider.
   * @param refs - references to describe.
   * @returns fulfillment after every declared reference was described.
   */
  private async readPresence(credentials: CredentialProvider, refs: readonly CredentialRef[]): Promise<void> {
    const present = new Set<CredentialRef>()
    for (const ref of refs) {
      if ((await credentials.describe(ref)).configured) present.add(ref)
    }
    this.presence = present
  }

  /**
   * The declared fallback route current credential presence selects, if any.
   * @returns the selected fallback route, or undefined while the primary route stands.
   */
  private activeFallback(): ModelSelection | undefined {
    const primary = this.primaryCredentialRef
    if (primary === undefined || this.presence.has(primary)) return undefined
    return this.fallbackRoutes.find(route => this.presence.has(route.credentialRef))?.selection
  }

  /**
   * One target's deployment route after credential substitution: only the main
   * route declares fallbacks, because every preset and named route pins its own
   * provider.
   * @param target - registered target whose route is read.
   * @returns the route a later Agent under this target starts from.
   */
  private deploymentRoute(target: ResolvedAgentModelTarget): ModelSelection {
    if (target.id !== MAIN_AGENT_MODEL_TARGET) return target.defaultSelection
    return this.activeFallback() ?? target.defaultSelection
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
    const mainTarget = this.targets.get(MAIN_AGENT_MODEL_TARGET)?.target
    if (mainTarget === undefined) throw new Error('agent-models: main deployment default is unavailable')
    const mainDefault = this.deploymentRoute(mainTarget)
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
   * The main route follows credential presence, and a stored selection is
   * projected under whichever provider that route currently names.
   * @param id - target to resolve; defaults to the main Agent.
   * @returns a detached complete selection.
   */
  currentSelection(id: AgentModelTargetId = MAIN_AGENT_MODEL_TARGET): ModelSelection {
    const target = this.targets.get(id)?.target
    if (target === undefined) throw new Error(`agent-models: unknown target "${String(id)}"`)
    const route = this.deploymentRoute(target)
    const configured = this.source().agents[id]
    return configured !== undefined && userOwns(ownDescriptor(this.ctx), id)
      ? selected(route.provider, configured)
      : { ...route }
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
      provider: this.deploymentRoute(target).provider,
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
    const target = this.targets.get(id)?.target
    if (target === undefined) throw new Error(`agent-models: unknown target "${String(id)}"`)
    const provider = this.deploymentRoute(target).provider
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
      .map(({ target }): AgentModelTargetView => {
        const route = this.deploymentRoute(target)
        return {
          id: target.id,
          label: target.label,
          provider: route.provider,
          selection: stored(this.currentSelection(target.id)),
          defaultSelection: stored(route),
          overridden: userOwns(descriptor, target.id),
        }
      })
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
