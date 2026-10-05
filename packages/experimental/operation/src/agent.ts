/**
 * Scoped operation-only presentation and eligibility for a coding profile.
 * @module @deepseek-ai/dsh-experimental-operation/agent
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { createForegroundProcessOperationPolicy, OperationToolPolicyError } from './policy.ts'
import type { OperationToolPolicy } from './policy.ts'
import type {} from './index.ts'

/** Plugin name for an explicitly composed coding profile. */
export const name = 'operation-agent'
/** Services used by scoped presentation, exact policy registration and prompt assembly. */
export const inject = ['operations', 'tools', 'systemPrompt']

/** Operator-owned action inventory and planner prompt bounds. */
export interface Config {
  /** Exact tools this composition reviews for operation execution. */
  tools: 'all' | string[]
  /** Maximum combined UTF-8 bytes of literal small-edit inputs. */
  maxMutationBytes: number
  /** Maximum complete action catalog size; excess fails assembly without truncation. */
  maxCatalogBytes: number
}

/** Required configuration; no action receives eligibility implicitly. */
export const Config: z<Config> = z.object({
  tools: z.union([z.const('all'), z.array(z.string())]).required(),
  maxMutationBytes: z.natural().min(1).required(),
  maxCatalogBytes: z.natural().min(1).required(),
})

const PLAN_GUIDANCE = 'Submit a version-one JSON plan with name, goal, inputs, steps and completion. Each step has a unique id, purpose, fixed tool name, arguments expression, nonempty assertions, observation.paths (JSON Pointers into its canonical result), and question. Completion has assertions, evidence expressions and question. Expressions are {kind:"literal",value:...}, {kind:"input",input:"name",pointer:""}, {kind:"result",step:"earlier-id",pointer:"/field"}, {kind:"selected",step:"earlier-id",pointer:"/field"}, {kind:"object",properties:{...}}, or {kind:"array",items:[...]}. References point backward only. Assertions include {kind:"present",value:expression} and {kind:"equals",left:expression,right:expression}. Make run_operation the only tool call in the response. Use short foreground shell plans and literal small edits. Shell commands and edits cannot derive arguments from tool output. Read/search can obtain evidence for later planning. The result includes the last complete declared observations. Incomplete evidence, uncertainty or failure returns control; analyze that outcome before submitting a new plan. Never automatically repeat an interrupted mutation.'

/**
 * Bind reviewed current definitions and collapse this profile's direct executor.
 * @param ctx Scoped coding composition owning the selected underlying tools.
 * @param config Explicit action inventory and limits.
 */
export function apply(ctx: Context, config: Config): void {
  const scope = scopeOf(ctx)
  if (scope === undefined) throw new Error('operation-agent requires an agent-scoped composition')
  let definitions: ToolDefinition[] | undefined
  function bind(): ToolDefinition[] {
    if (definitions !== undefined) return definitions
    const tools = config.tools === 'all'
      ? ctx.tools.schemas(scope).map(tool => tool.name).filter(tool => tool !== 'run_operation' && tool !== 'run_code')
      : config.tools
    if (tools.length === 0 || new Set(tools).size !== tools.length) {
      throw new Error('operation-agent requires a nonempty unique action inventory')
    }
    const captured = tools.map((tool) => {
      if (tool === 'run_operation' || tool === 'run_code') throw new Error('operation-agent cannot admit recursive composition transports')
      const definition = ctx.tools.get(tool, scope)
      if (definition === undefined) throw new Error(`operation-agent requires its composed ${JSON.stringify(tool)} definition`)
      return definition
    })
    ctx.effect(() => {
      const disposers: (() => void)[] = []
      try {
        for (const definition of captured) {
          disposers.push(ctx.operations.toolPolicies.register(definition, policyFor(definition.name, config.maxMutationBytes)))
        }
      } catch (error) {
        for (const dispose of disposers.reverse()) dispose()
        throw error
      }
      return () => { for (const dispose of disposers.reverse()) dispose() }
    }, 'operation-agent.bindPolicies()')
    definitions = captured
    return captured
  }
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name === 'run_operation') bind()
    return next()
  })
  ctx.tools.presentAs('operation')
  ctx.systemPrompt.section({
    name: 'operation:plan',
    order: ctx.systemPrompt.getSectionOrder('TOOLS_SDK'),
    text: (context) => {
      const catalog = bind().filter(definition =>
        (context.agent === undefined ? ctx.tools.get(definition.name, context.scope)
          : ctx.tools.admitted(definition.name, context.agent, true)) === definition)
        .map(definition => ({ name: definition.name, description: definition.description,
          parameters: definition.parameters, output: definition.output.schema }))
      const text = `${PLAN_GUIDANCE}\n\nOperation action catalog:\n${JSON.stringify(catalog)}`
      if (Buffer.byteLength(text, 'utf8') > config.maxCatalogBytes) {
        throw new Error('operation-agent action catalog exceeds its configured complete-byte limit')
      }
      return text
    },
  })
}

function policyFor(tool: string, maxMutationBytes: number): OperationToolPolicy {
  if (tool === 'bash' || tool === 'pwsh') return createForegroundProcessOperationPolicy()
  return {
    allowOutputReferences: tool === 'read' || tool === 'glob' || tool === 'grep',
    validateArguments(value) {
      const args = object(value)
      if (args.run_in_background === true || args.background === true) {
        throw new OperationToolPolicyError('operation actions must settle in the foreground')
      }
      if (tool !== 'write' && tool !== 'edit') return
      const strings = tool === 'write' ? [args.content] : [args.old_string, args.new_string]
      if (!strings.every((value): value is string => typeof value === 'string')
        || strings.reduce((total, value) => total + Buffer.byteLength(value, 'utf8'), 0) > maxMutationBytes) {
        throw new OperationToolPolicyError('operation edit exceeds the configured literal mutation limit')
      }
    },
    inspectResult(value) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)
        && (value.kind === 'background' || value.running === true || value.status === 'running' || value.status === 'pending')) {
        return { kind: 'incomplete', reason: 'action returned pending work rather than a settled result' }
      }
      if (tool === 'read') {
        const result = object(value)
        if (result.truncatedByBytes === true || (Array.isArray(result.truncatedLineNumbers) && result.truncatedLineNumbers.length > 0)) {
          return { kind: 'incomplete', reason: 'declared read window contains clipped evidence' }
        }
      }
      return { kind: 'complete' }
    },
  }
}

function object(value: JsonValue): Readonly<Record<string, JsonValue>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OperationToolPolicyError('operation action requires a canonical object')
  }
  return value
}
