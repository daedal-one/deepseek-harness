import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { turnBoundaryProjectionDefinition } from '@deepseek-ai/dsh-agent-loop'
import PlanModeController, { PLAN_MODE_SECTION, resolveConfig } from '../src/index.ts'

/**
 * The plan-mode policy text exactly as the base bundle patch carried it before
 * the schema default replaced that literal. Rendered model text must stay
 * byte-identical to this fixture.
 */
const OLD_BASE_PATCH_SECTION = `You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.

Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.

The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed only to keep the request shape stable. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.

Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.

Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.

When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.
`

async function planningAgent(ctx: Context): Promise<Agent & { session: Session }> {
  const session = Session.create(SessionId('section-default'))
  session.append('plan/mode', { active: true })
  const agent = {
    id: SessionId('section-default'),
    session,
    options: {},
    inject() {},
  } as unknown as Agent & { session: Session }
  let scoped!: Context
  await ctx.plugin(Object.assign((inner: Context) => { scoped = createScope(inner, agent).ctx }, {
    inject: ['tools'],
  }))
  ;(agent as { ctx?: Context }).ctx = scoped
  ctx.emit('agent/created', { agent })
  return agent
}

describe('plan-mode section ownership', () => {
  it('carries the previous base-patch prose as the config default', () => {
    expect(PLAN_MODE_SECTION).toBe(OLD_BASE_PATCH_SECTION)
    expect(resolveConfig({})).toEqual({ section: OLD_BASE_PATCH_SECTION })
  })

  it('renders the default section byte-identically when the deployment omits config.section', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionProjectionRegistry)
    ctx.sessionProjections.register(turnBoundaryProjectionDefinition)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    // No config at all: the loader's schema default supplies the section.
    await ctx.plugin(PlanModeController)
    const agent = await planningAgent(ctx)
    const assembly = await ctx.systemPrompt.assemble({ agent, scope: agent })
    const section = assembly.sections.find(candidate => candidate.name === 'plan:policy')?.text
    expect(section).toBe(OLD_BASE_PATCH_SECTION)
    expect(section?.length).toBe(OLD_BASE_PATCH_SECTION.length)
  })
})
