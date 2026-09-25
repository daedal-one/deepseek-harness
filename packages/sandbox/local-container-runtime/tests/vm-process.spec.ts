import { describe, expect, it } from 'vitest'
import { validateGuestGitAuthorization } from '../src/vm-process.ts'

describe('development VM guest Git authorization', () => {
  it('accepts a complete URL-scoped KEY=VALUE environment without retaining aliases', () => {
    const values = [
      'GIT_CONFIG_COUNT=2',
      'GIT_CONFIG_KEY_0=credential.helper',
      'GIT_CONFIG_VALUE_0=',
      'GIT_CONFIG_KEY_1=http.https://github.example/org/repo.git/.extraHeader',
      'GIT_CONFIG_VALUE_1=Authorization: Basic dXNlcjp0b2tlbg==',
    ]
    const result = validateGuestGitAuthorization(values)
    expect(result).toEqual(values)
    expect(result).not.toBe(values)
  })

  it.each([
    ['missing separator', ['GIT_CONFIG_COUNT']],
    ['duplicate assignment', ['GIT_CONFIG_COUNT=1', 'GIT_CONFIG_COUNT=1', 'GIT_CONFIG_KEY_0=credential.helper', 'GIT_CONFIG_VALUE_0=']],
    ['wrong count', ['GIT_CONFIG_COUNT=2', 'GIT_CONFIG_KEY_0=credential.helper', 'GIT_CONFIG_VALUE_0=']],
    ['unscoped key', ['GIT_CONFIG_COUNT=1', 'GIT_CONFIG_KEY_0=http.extraHeader', 'GIT_CONFIG_VALUE_0=Authorization: Basic dGVzdA==']],
    ['raw credential', ['TOKEN=secret']],
    ['line break', ['GIT_CONFIG_COUNT=1', 'GIT_CONFIG_KEY_0=credential.helper\nsecret', 'GIT_CONFIG_VALUE_0=']],
  ])('rejects %s without including authorization values in the diagnostic', (_name, values) => {
    expect(() => validateGuestGitAuthorization(values)).toThrow('development-vm: guest Git authorization')
    try { validateGuestGitAuthorization(values) }
    catch (error) { expect(String(error)).not.toContain('secret') }
  })
})
