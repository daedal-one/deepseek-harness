import { execFile } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gitAuthorization, validateGitRemote } from '../src/git-authorization.ts'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
afterEach(() => { vi.restoreAllMocks(); vi.mocked(execFile).mockReset() })

const remote = { source: '/project', url: 'https://github.com/example/private.git', credentialCommand: '/trusted/helper', credentialTimeoutMs: 5000 }

function helper(output: string, error: Error | null = null) {
  const end = vi.fn()
  vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error | null, stdout: string, stderr: string) => void
    queueMicrotask(() =>{  callback(error, output, 'sensitive helper diagnostics') })
    return { stdin: { on: vi.fn(), end } } as never
  })
  return end
}

describe('workspace Git credential broker', () => {
  it('requests only the configured repository, scopes the Git header, and refreshes expiring credentials', async () => {
    const now = 1_800_000_000_000
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    const end = helper(`username=x-access-token\npassword=ephemeral-test-secret\npassword_expiry_utc=${now / 1000 + 3600}\n\n`)
    const authorize = gitAuthorization(remote)
    const first = await authorize()
    expect(end).toHaveBeenCalledWith('protocol=https\nhost=github.com\npath=example/private.git\n\n')
    expect(first).toContain('GIT_CONFIG_KEY_0=http.https://github.com/example/private.git/.extraHeader')
    expect(first).toContain('GIT_CONFIG_KEY_1=credential.helper')
    expect(first.join('\n')).not.toContain('/trusted/helper')
    first[0] = 'mutated'
    expect((await authorize())[0]).toBe('GIT_CONFIG_COUNT=2')
    expect(execFile).toHaveBeenCalledTimes(1)
    clock.mockReturnValue(now + 3_550_000)
    helper(`username=x-access-token\npassword=refreshed-test-secret\npassword_expiry_utc=${now / 1000 + 7100}\n`)
    expect(await authorize()).not.toEqual(first)
    expect(execFile).toHaveBeenCalledTimes(2)
  })

  it('keeps helper output and error details out of authentication failures', async () => {
    helper('password=must-not-leak', new Error('must-not-leak'))
    await expect(gitAuthorization(remote)()).rejects.toThrow('workspace Git authentication failed')
    await expect(gitAuthorization(remote)()).rejects.not.toThrow('must-not-leak')
  })

  it.each([
    'username=user\npassword=secret\n',
    'username=user\npassword=secret\npassword_expiry_utc=1\n',
    'username=user\nusername=other\npassword=secret\n',
    'username=user\npassword=secret\npassword_expiry_utc=999999999999\n',
  ])('rejects malformed or unbounded credentials', async (output) => {
    helper(output)
    await expect(gitAuthorization(remote)()).rejects.toThrow(/credential/)
  })

  it.each(['http://github.com/example/private.git', 'https://user:secret@github.com/example/private.git', 'https://github.com/example/private.git?other=1', 'https://github.com/example/../private.git'])('rejects an unsafe configured URL', (url) => {
    expect(() => validateGitRemote({ ...remote, url })).toThrow()
  })

  it.each([{ credentialCommand: 'relative-helper' }, { credentialTimeoutMs: 0 }])('rejects an invalid helper configuration', (config) => {
    expect(() => validateGitRemote({ ...remote, ...config })).toThrow()
  })

  it.each(['EPIPE', 'EIO'])('handles a helper stdin failure without exposing diagnostics: %s', async (code) => {
    let callback!: (error: Error | null, stdout: string) => void
    vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
      callback = args.at(-1) as typeof callback
      return { stdin: { on(_event: string, listener: (error: NodeJS.ErrnoException) => void) {
        queueMicrotask(() => { listener(Object.assign(new Error('sensitive input'), { code })) })
      }, end() {} } } as never
    })
    const pending = gitAuthorization(remote)()
    if (code === 'EPIPE') {
      queueMicrotask(() => { callback(new Error('helper failed'), '') })
      await expect(pending).rejects.toThrow('authentication failed')
    } else await expect(pending).rejects.toThrow('helper request failed')
  })

  it('does not invoke a helper for a public remote', async () => {
    const { credentialCommand: _, ...publicRemote } = remote
    expect(await gitAuthorization(publicRemote)()).toEqual([])
    expect(execFile).not.toHaveBeenCalled()
  })
})
