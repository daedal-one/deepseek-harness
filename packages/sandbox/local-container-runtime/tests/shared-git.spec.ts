import { afterEach, describe, expect, it, vi } from 'vitest'
import * as credentials from '../src/git-authorization.ts'
import { sharedGitAuthorization } from '../src/shared-git.ts'
import { validateGuestGitAuthorization } from '../src/vm-process.ts'

const repositories = [{ source: '/repos/first', path: '/workspace/first' }, { source: '/repos/second', path: '/workspace/second' }]
const remote = { source: '/repos/first', url: 'https://github.example/org/first.git', credentialCommand: '/bin/helper', credentialTimeoutMs: 1000 }
afterEach(() => vi.restoreAllMocks())

describe('shared repository credentials', () => {
  it('does not issue credentials for an unconfigured environment', async () => {
    const issuer = vi.spyOn(credentials, 'gitAuthorization')
    expect(await sharedGitAuthorization(repositories, [])()).toEqual([])
    expect(issuer).not.toHaveBeenCalled()
  })

  it.each([
    [{ ...remote, source: '/repos/first/nested' }],
    [{ source: remote.source, url: remote.url, credentialTimeoutMs: remote.credentialTimeoutMs }],
    [remote, remote],
    [remote, { ...remote, source: '/repos/second' }],
    [{ ...remote, url: 'http://github.example/org/first.git' }],
    [{ ...remote, credentialCommand: 'helper' }],
  ])('rejects invalid or ambiguous operator access: %j', (...remotes) => {
    expect(() => sharedGitAuthorization(repositories, remotes)).toThrow()
  })

  it('reindexes multiple repositories and rewrites only their SSH aliases', async () => {
    vi.spyOn(credentials, 'gitAuthorization').mockImplementation(() => async () => [
      'GIT_CONFIG_COUNT=2', 'GIT_CONFIG_KEY_0=ignored', 'GIT_CONFIG_VALUE_0=Authorization: Basic dGVzdA==',
      'GIT_CONFIG_KEY_1=credential.helper', 'GIT_CONFIG_VALUE_1=',
    ])
    const result = await sharedGitAuthorization(repositories, [remote, { ...remote, source: '/repos/second', url: 'https://github.example/org/second.git' }])()
    expect(validateGuestGitAuthorization(result)).toEqual(result)
    expect(result).toEqual([
      'GIT_CONFIG_COUNT=7', 'GIT_CONFIG_KEY_0=credential.helper', 'GIT_CONFIG_VALUE_0=',
      'GIT_CONFIG_KEY_1=http.https://github.example/org/first.git/.extraHeader', 'GIT_CONFIG_VALUE_1=Authorization: Basic dGVzdA==',
      'GIT_CONFIG_KEY_2=url.https://github.example/org/first.git.insteadOf', 'GIT_CONFIG_VALUE_2=git@github.example:org/first.git',
      'GIT_CONFIG_KEY_3=url.https://github.example/org/first.git.insteadOf', 'GIT_CONFIG_VALUE_3=ssh://git@github.example/org/first.git',
      'GIT_CONFIG_KEY_4=http.https://github.example/org/second.git/.extraHeader', 'GIT_CONFIG_VALUE_4=Authorization: Basic dGVzdA==',
      'GIT_CONFIG_KEY_5=url.https://github.example/org/second.git.insteadOf', 'GIT_CONFIG_VALUE_5=git@github.example:org/second.git',
      'GIT_CONFIG_KEY_6=url.https://github.example/org/second.git.insteadOf', 'GIT_CONFIG_VALUE_6=ssh://git@github.example/org/second.git',
    ])
  })

  it('does not infer SSH aliases for custom HTTPS ports', async () => {
    vi.spyOn(credentials, 'gitAuthorization').mockReturnValue(async () => ['GIT_CONFIG_VALUE_0=Authorization: Basic dGVzdA=='])
    const result = await sharedGitAuthorization(repositories, [{ ...remote, url: 'https://github.example:8443/org/first.git' }])()
    expect(validateGuestGitAuthorization(result)).toEqual(result)
    expect(result).toHaveLength(5)
  })

  it('coalesces concurrent issuance and permits a fresh attempt after failure', async () => {
    const issued = Promise.withResolvers<string[]>()
    const issue = vi.fn(() => issued.promise)
    vi.spyOn(credentials, 'gitAuthorization').mockReturnValue(issue)
    const authorize = sharedGitAuthorization(repositories, [remote])
    const first = authorize(); const second = authorize()
    const rejected = Promise.all([expect(first).rejects.toThrow('issuance failed'), expect(second).rejects.toThrow('issuance failed')])
    expect(issue).toHaveBeenCalledOnce()
    issued.reject(new Error('issuance failed')); await rejected
    issue.mockResolvedValue(['GIT_CONFIG_VALUE_0=Authorization: Basic dGVzdA=='])
    await expect(authorize()).resolves.toContain('GIT_CONFIG_COUNT=4')
    expect(issue).toHaveBeenCalledTimes(2)
  })

  it('fails closed when the issuer produces no header', async () => {
    vi.spyOn(credentials, 'gitAuthorization').mockReturnValue(async () => [])
    await expect(sharedGitAuthorization(repositories, [remote])()).rejects.toThrow('no repository authorization')
  })
})
