import { ToolPolicyProviderId } from '@deepseek-ai/dsh-tool-policy'
import { describe, expect, it } from 'vitest'
import { decideEvidence, parseEffectReview, parseIntentReview, type EffectReview, type IntentReview } from '../src/effects.ts'
import { configuredRuleDecision, gitEscalationDecision, hardSecurityDecision } from '../src/index.ts'

const bounds = { maxEffects: 8, maxSummaryChars: 40, maxReasonChars: 40 }
const intent = (allowedEffects: IntentReview['allowedEffects'] = []): IntentReview => ({
  userSummary: 'change workspace', agentSummary: 'change workspace', allowedEffects,
  forbiddenEffects: ['credential-access'], alignment: 'aligned',
})
const effect = (effects: EffectReview['effects'], risk = 10): EffectReview => ({ effects, risk, reason: 'classified effect' })

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

describe('independent evidence policy', () => {
  it('accepts only exact closed result fields and vocabulary', () => {
    expect(parseIntentReview({
      userSummary: 'read', agentSummary: 'read', allowedEffects: ['workspace-read'], forbiddenEffects: [], alignment: 'aligned',
    }, bounds)).toMatchObject({ alignment: 'aligned' })
    expect(parseIntentReview({
      userSummary: 'read', agentSummary: 'read', allowedEffects: ['workspace-read'], forbiddenEffects: [], alignment: 'aligned', extra: true,
    }, bounds)).toBeUndefined()
    expect(parseEffectReview({ effects: ['invented'], risk: 1, reason: 'x' }, bounds)).toBeUndefined()
    expect(parseEffectReview({ effects: ['workspace-read'], risk: 1, reason: 'x' }, bounds)).toMatchObject({ effects: ['workspace-read'] })
  })

  it('allows baseline reads and explicitly requested workspace mutation', () => {
    expect(decideEvidence(ToolPolicyProviderId('shell'), intent(), effect(['workspace-read']), []).decision).toBe('allow')
    expect(decideEvidence(ToolPolicyProviderId('shell'), intent(['workspace-write']), effect(['workspace-write']), []).decision).toBe('allow')
  })

  it('asks for unrequested mutations, restrictions, and sensitive effects', () => {
    expect(decideEvidence(ToolPolicyProviderId('shell'), intent(), effect(['workspace-write']), []).decision).toBe('ask')
    expect(decideEvidence(ToolPolicyProviderId('shell'), intent(), effect(['credential-access']), []).decision).toBe('ask')
    expect(decideEvidence(ToolPolicyProviderId('shell'), intent(), effect(['network-read']), []).decision).toBe('ask')
  })

  it('reports risk from the selected evidence rather than a failed superseded route', () => {
    const failed = { providerId: ToolPolicyProviderId('primary'), decision: 'ask' as const, risk: 100, categories: ['invalid-output'], reason: 'bad' }
    expect(decideEvidence(ToolPolicyProviderId('shell'), intent(), effect(['host-read'], 12), [failed])).toMatchObject({ decision: 'allow', risk: 12 })
  })
})
