/** Operator-selected repository credentials for the shared VM command environment. @module */
import { gitAuthorization, validateGitRemote } from './git-authorization.ts'
import type { WorkspaceGitRemote } from './types.ts'
import type { VmDirectoryMount } from './vm-engine.ts'

/** Resolve mounted-repository authorization without consulting guest Git configuration.
 * @param repositories - the exact admitted directory sources.
 * @param remotes - operator-approved repositories and bounded credential issuers.
 * @returns process-only Git configuration, refreshed before credential expiry.
 */
export function sharedGitAuthorization(
  repositories: readonly VmDirectoryMount[], remotes: readonly WorkspaceGitRemote[],
): () => Promise<string[]> {
  const sources = new Set<string>(); const urls = new Set<string>()
  const grants = remotes.map((remote) => {
    const url = validateGitRemote(remote)
    if (!repositories.some(mount => mount.source === remote.source) || remote.credentialCommand === undefined
      || sources.has(remote.source) || urls.has(url.href)) throw new Error('shared-vm: Git access requires unique mounted repositories and explicit credential helpers')
    sources.add(remote.source); urls.add(url.href)
    return { url, authorize: gitAuthorization(remote) }
  })
  const issue = async () => {
    if (grants.length === 0) return []
    const entries: Array<[string, string]> = [['credential.helper', '']]
    for (const grant of grants) {
      const environment = await grant.authorize()
      const header = environment.find(entry => entry.startsWith('GIT_CONFIG_VALUE_0='))?.slice('GIT_CONFIG_VALUE_0='.length)
      if (header === undefined) throw new Error('shared-vm: credential issuer returned no repository authorization')
      entries.push([`http.${grant.url.href}/.extraHeader`, header])
      if (grant.url.port === '') {
        entries.push([`url.${grant.url.href}.insteadOf`, `git@${grant.url.host}:${grant.url.pathname.slice(1)}`],
          [`url.${grant.url.href}.insteadOf`, `ssh://git@${grant.url.host}${grant.url.pathname}`])
      }
    }
    return [`GIT_CONFIG_COUNT=${entries.length}`, ...entries.flatMap(([key, value], index) => [`GIT_CONFIG_KEY_${index}=${key}`, `GIT_CONFIG_VALUE_${index}=${value}`])]
  }
  let pending: Promise<string[]> | undefined
  return () => pending ??= issue().finally(() => { pending = undefined })
}
