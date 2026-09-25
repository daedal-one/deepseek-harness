/** Expiring Git authorization selected exclusively by deployment configuration. @module */
import { execFile } from 'node:child_process'
import { isAbsolute } from 'node:path'
import type { WorkspaceGitRemote } from './types.ts'

/** Validate an operator-selected remote before it can select a host helper request.
 * @param remote - configured source, URL, and bounded credential helper.
 * @returns the parsed credential-free HTTPS URL.
 */
export function validateGitRemote(remote: WorkspaceGitRemote): URL {
  const url = new URL(remote.url)
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== ''
    || !/^\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u.test(url.pathname)
    || url.href !== remote.url || !isAbsolute(remote.source) || remote.source.includes('\0')) {
    throw new Error('workspace remote requires an absolute source and a canonical credential-free HTTPS repository URL')
  }
  if (remote.credentialCommand !== undefined && (!isAbsolute(remote.credentialCommand) || remote.credentialCommand.includes('\0'))) {
    throw new Error('workspace credential helper must be an absolute executable path')
  }
  if (!Number.isSafeInteger(remote.credentialTimeoutMs) || remote.credentialTimeoutMs < 1 || remote.credentialTimeoutMs > 2_147_483_647) {
    throw new Error('workspace credential timeout must be a positive bounded integer')
  }
  return url
}

/** Create a cache for one environment grant revision; tokens are never written to workspace storage.
 * @param remote - trusted deployment authorization, independent of sandbox Git configuration.
 * @returns URL-scoped Git environment entries, refreshed before their expiry.
 */
export function gitAuthorization(remote: WorkspaceGitRemote): () => Promise<string[]> {
  const url = validateGitRemote(remote)
  const command = remote.credentialCommand
  if (command === undefined) return () => Promise.resolve([])
  let cached: { expires: number; environment: string[] } | undefined
  return async () => {
    if (cached !== undefined && cached.expires > Date.now() + 60_000) return [...cached.environment]
    const output = await new Promise<string>((resolve, reject) => {
      const child = execFile(command, ['get'], {
        timeout: remote.credentialTimeoutMs, maxBuffer: 8192, killSignal: 'SIGKILL',
        env: { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8' },
      }, (error, stdout) => {
        if (error !== null) reject(new Error('workspace Git authentication failed; check the configured helper and repository access'))
        else resolve(stdout)
      })
      child.stdin?.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EPIPE') reject(new Error('workspace credential helper request failed'))
      })
      child.stdin?.end(`protocol=https\nhost=${url.host}\npath=${url.pathname.slice(1)}\n\n`)
    })
    const fields = new Map<string, string>()
    for (const line of output.trim().split(/\r?\n/u)) {
      const separator = line.indexOf('=')
      if (separator < 1 || fields.has(line.slice(0, separator))) throw new Error('workspace credential helper returned an invalid response')
      fields.set(line.slice(0, separator), line.slice(separator + 1))
    }
    const username = fields.get('username'); const password = fields.get('password')
    const expires = Number(fields.get('password_expiry_utc')) * 1000
    if (username === undefined || username.length === 0 || username.includes(':') || password === undefined || password.length === 0
      || /[\x00-\x20\x7f]/u.test(username + password) || !Number.isSafeInteger(expires) || expires <= Date.now() + 60_000
      || expires > Date.now() + 3_600_000) throw new Error('workspace credential helper must issue a repository-scoped credential expiring within one hour')
    const authorization = Buffer.from(`${username}:${password}`).toString('base64')
    const environment = ['GIT_CONFIG_COUNT=2', `GIT_CONFIG_KEY_0=http.${url.href}/.extraHeader`,
      `GIT_CONFIG_VALUE_0=Authorization: Basic ${authorization}`, 'GIT_CONFIG_KEY_1=credential.helper', 'GIT_CONFIG_VALUE_1=']
    cached = { expires, environment }
    return [...environment]
  }
}
