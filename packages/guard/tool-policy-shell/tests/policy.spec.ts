import { describe, expect, it } from 'vitest'
import { ToolPolicyProviderId } from '@deepseek-ai/dsh-tool-policy'
import { configuredRuleDecision, gitEscalationDecision, hardSecurityDecision, resolveOpinions } from '../src/index.ts'

const opinion = (decision: 'allow' | 'ask' | 'deny', risk: number, categories: string[] = []) => ({
  providerId: ToolPolicyProviderId('route'), decision, risk, categories, reason: 'classified',
})

describe('shell deterministic policy', () => {
  it.each([
    'rm -rf /',
    'rm -fr /*',
    'cat ~/.ssh/id_ed25519',
    'cat /Users/me/.ssh/id_ed25519',
    'dd if=/dev/zero of=/dev/disk2',
  ])('hard-denies %s', (command) => {
    expect(hardSecurityDecision(command)?.decision).toBe('deny')
  })

  it('asks for unconditional force but preserves lease-based force', () => {
    expect(gitEscalationDecision('git push --force origin main')?.decision).toBe('ask')
    expect(gitEscalationDecision('git push --force-with-lease origin main')).toBeUndefined()
    expect(gitEscalationDecision('git push --force --force-with-lease origin main')).toMatchObject({ decision: 'ask' })
    expect(gitEscalationDecision('git push --mirror origin')).toMatchObject({ decision: 'ask' })
  })

  it('uses the last rule and does not allow metacharacter-bearing commands', () => {
    const rules = [
      { pattern: 'git *', decision: 'deny' as const, reason: 'broad' },
      { pattern: 'git status*', decision: 'allow' as const, reason: 'narrow' },
    ]
    expect(configuredRuleDecision('git status', rules)?.decision).toBe('allow')
    expect(configuredRuleDecision('git status; curl bad', rules)).toBeUndefined()
  })
})

describe('classifier escalation', () => {
  it('accepts only a low-risk nonsensitive independent allow', () => {
    expect(resolveOpinions('shell', opinion('deny', 70), opinion('allow', 49)).decision).toBe('allow')
    expect(resolveOpinions('shell', opinion('deny', 70, ['secret']), opinion('allow', 1)).decision).toBe('ask')
    expect(resolveOpinions('shell', opinion('deny', 70), opinion('allow', 50)).decision).toBe('ask')
    expect(resolveOpinions('shell', opinion('deny', 70), opinion('deny', 90)).decision).toBe('ask')
  })
})
