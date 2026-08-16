/**
 * Shared application-entry composition for fresh and resumed agents. Surface
 * runners supply their own pre-publication setup; this helper adds the optional
 * preset roster without duplicating resolution or mount ordering.
 *
 * @module @deepseek-ai/dsh-agent-presets/composition
 */

import type { Context } from '@deepseek-ai/cordis'

/** One resolved agent composition ready for `ctx.agents.create()` or `resume()`. */
export interface ResolvedAgentComposition {
  /** Preset id to persist on the Session header, absent without a roster. */
  readonly agentPreset?: string
  /** Pre-publication setup that installs the surface state and selected preset. */
  readonly setup: (agentCtx: Context) => Promise<void>
}

/**
 * Resolve the optional preset roster and compose it after surface-owned setup.
 * The preset id is resolved before Session creation so callers can persist it;
 * mounting remains inside the agent factory setup so a failure rolls creation
 * back before publication.
 * @param ctx - application context that may carry `ctx.agentPresets`.
 * @param presetId - explicit preset id, or undefined for the roster default.
 * @param setupSurface - surface-specific pre-publication setup.
 * @returns the header value and complete setup callback.
 */
export async function resolveAgentComposition(
  ctx: Context,
  presetId: string | undefined,
  setupSurface: (agentCtx: Context) => Promise<void> | void,
): Promise<ResolvedAgentComposition> {
  const presets = ctx.get('agentPresets')
  if (presets === undefined) {
    return {
      setup: async (agentCtx) => {
        await setupSurface(agentCtx)
      },
    }
  }
  const resolvedId = (await presets.resolve(presetId)).id
  return {
    agentPreset: resolvedId,
    setup: async (agentCtx) => {
      await setupSurface(agentCtx)
      await presets.mount(agentCtx, resolvedId)
    },
  }
}
