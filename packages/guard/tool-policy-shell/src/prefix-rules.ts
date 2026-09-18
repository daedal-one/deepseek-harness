/** Literal argument-prefix rules and activation-time examples. @module */

import type { ToolPolicyDecision } from '@deepseek-ai/dsh-tool-policy'
import { parseLiteralCommand } from './safe-read.ts'

/** A literal argument prefix with optional alternatives at each position. */
export interface CommandPrefixRule {
  /** Ordered argument tokens; an array at one position permits any listed literal. */
  readonly pattern: readonly (string | readonly string[])[]
  /** Decision combined with other matches by deny, then ask, then allow. */
  readonly decision: ToolPolicyDecision
  /** Secret-free explanation retained in the policy decision. */
  readonly reason: string
  /** Complete literal commands that must match this rule at activation. */
  readonly match?: readonly string[]
  /** Complete commands that must not match this rule at activation. */
  readonly notMatch?: readonly string[]
}

const severity: Record<ToolPolicyDecision, number> = { allow: 0, ask: 1, deny: 2 }

function matches(tokens: readonly string[], rule: CommandPrefixRule): boolean {
  return tokens.length >= rule.pattern.length && rule.pattern.every((token, index) =>
    typeof token === 'string' ? tokens[index] === token : token.includes(tokens[index] as string))
}

/**
 * Validate rule patterns and their executable examples before provider registration.
 * @param rules - configured literal prefix rules.
 * @throws when a pattern is empty, a reason is blank, or an example contradicts its rule.
 */
export function validatePrefixRules(rules: readonly CommandPrefixRule[]): void {
  rules.forEach((rule, index) => {
    const fail = (message: string): never => { throw new Error(`tool-policy-shell: prefixRules[${index}] ${message}`) }
    if (rule.pattern.length === 0 || rule.pattern.some(token =>
      typeof token === 'string' ? token.length === 0 : token.length === 0 || token.some(value => value.length === 0))) {
      fail('pattern must contain non-empty literal tokens or non-empty alternatives')
    }
    if (rule.reason.trim().length === 0) fail('reason must explain the decision')
    for (const command of rule.match ?? []) {
      const tokens = parseLiteralCommand(command)
      if (tokens === undefined || !matches(tokens, rule)) fail(`match example ${JSON.stringify(command)} does not match; use one literal POSIX command with this prefix`)
    }
    for (const command of rule.notMatch ?? []) {
      const tokens = parseLiteralCommand(command)
      if (tokens !== undefined && matches(tokens, rule)) fail(`notMatch example ${JSON.stringify(command)} matches; narrow the pattern or correct the example`)
    }
  })
}

/**
 * Match a complete literal command and combine all matching explanations at the strictest decision.
 * @param command - exact command from a POSIX mapping.
 * @param rules - validated prefix rules.
 * @returns the strictest match, ask for unsupported syntax with active rules, or undefined without a match.
 */
export function matchPrefixRules(
  command: string, rules: readonly CommandPrefixRule[],
): { decision: ToolPolicyDecision; reason: string } | undefined {
  if (rules.length === 0) return undefined
  const tokens = parseLiteralCommand(command)
  if (tokens === undefined) return { decision: 'ask', reason: 'command syntax requires explicit approval with prefix rules' }
  const matched = rules.filter(rule => matches(tokens, rule))
  if (matched.length === 0) return undefined
  const decision = matched.reduce<ToolPolicyDecision>((current, rule) =>
    severity[rule.decision] > severity[current] ? rule.decision : current, 'allow')
  const reasons = [...new Set(matched.filter(rule => rule.decision === decision).map(rule => rule.reason))].sort()
  return { decision, reason: reasons.join('; ') }
}
