import { describe, expect, it } from 'vitest'
import { matchPrefixRules, validatePrefixRules, type CommandPrefixRule } from '../src/prefix-rules.ts'
import { parseLiteralCommand } from '../src/safe-read.ts'

const rule: CommandPrefixRule = {
  pattern: ['git', ['status', 'diff']], decision: 'allow', reason: 'inspect changes',
  match: ['git status --short', "git 'diff' --stat"], notMatch: ['git statusx', '/usr/bin/git status', 'git push'],
}

describe('literal command-prefix policy', () => {
  it('matches whole tokens, quoted literal arguments, alternatives, and explicit executable paths', () => {
    expect(() => { validatePrefixRules([rule]) }).not.toThrow()
    expect(matchPrefixRules('git "status" --short', [rule])).toEqual({ decision: 'allow', reason: 'inspect changes' })
    expect(matchPrefixRules('git statusx', [rule])).toBeUndefined()
    expect(matchPrefixRules('/usr/bin/git status', [rule])).toBeUndefined()
    expect(matchPrefixRules('git', [rule])).toBeUndefined()
    expect(matchPrefixRules('/usr/bin/git status', [{ ...rule, pattern: ['/usr/bin/git', 'status'] }])).toBeDefined()
    expect(parseLiteralCommand("printf '%s' 'literal ; > $HOME'")).toEqual(['printf', '%s', 'literal ; > $HOME'])
  })

  it.each(['git status; touch file', 'git status\nwhoami', 'git status\rwhoami', 'git status && whoami', 'git status | cat', 'git status > file', 'git status 2>/dev/null', 'git status $(whoami)', 'git status "$HOME"', 'git status `whoami`', 'git status *.ts', 'git status \\x', "git 'status", '', '   '])('leaves unsupported execution unapproved: %s', (command) => {
    expect(parseLiteralCommand(command)).toBeUndefined()
    expect(matchPrefixRules(command, [rule])).toMatchObject({ decision: 'ask' })
    expect(matchPrefixRules(command, [])).toBeUndefined()
  })

  it.each(['git status ~/file', 'git\vstatus', 'git\u00a0status'])('rejects nonliteral shell words: %s', (command) => {
    expect(parseLiteralCommand(command)).toBeUndefined()
  })

  it('takes the strictest decision and stable explanations regardless of order', () => {
    const ask: CommandPrefixRule = { pattern: ['git'], decision: 'ask', reason: 'review git' }
    const deny: CommandPrefixRule = { pattern: ['git', 'status'], decision: 'deny', reason: 'disabled' }
    expect(matchPrefixRules('git status', [rule, ask])).toEqual({ decision: 'ask', reason: 'review git' })
    expect(matchPrefixRules('git status', [rule, ask, deny])).toEqual({ decision: 'deny', reason: 'disabled' })
    expect(matchPrefixRules('git status', [deny, ask, rule])).toEqual({ decision: 'deny', reason: 'disabled' })
    expect(matchPrefixRules('git status', [ask, { ...ask, reason: 'another reason' }, ask])).toEqual({ decision: 'ask', reason: 'another reason; review git' })
  })

  it('rejects invalid patterns and contradictory executable examples at activation', () => {
    for (const pattern of [[], [''], [[]], [['git', '']]]) {
      expect(() => { validatePrefixRules([{ ...rule, pattern }]) }).toThrow('pattern must contain')
    }
    expect(() => { validatePrefixRules([{ ...rule, reason: ' ' }]) }).toThrow('reason must explain')
    expect(() => { validatePrefixRules([{ ...rule, match: ['git push'] }]) }).toThrow('match example')
    expect(() => { validatePrefixRules([{ ...rule, match: ['git status; whoami'] }]) }).toThrow('literal POSIX command')
    expect(() => { validatePrefixRules([{ ...rule, notMatch: ['git status'] }]) }).toThrow('notMatch example')
    expect(() => { validatePrefixRules([{ pattern: ['git'], decision: 'ask', reason: 'review' }]) }).not.toThrow()
    expect(() => { validatePrefixRules([{ ...rule, notMatch: ['git status; whoami'] }]) }).not.toThrow()
  })
})
