/** Bound remote refresh: credentialed private fetch, confined local import and ref transaction. */
import { lstat, mkdtemp, readFile, readdir, realpath, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { publicationGit, sourceGit, transportEnvironment, validateManagedClone, type GitPublicationConfig } from './git-push.ts'

/** Verified remote-tracking changes; local development state is never selected for mutation. */
export interface BranchRefresh {
  readonly repository: string
  readonly updated: string[]
  readonly unchanged: number
}

async function metadataPath(root: string, relative: string): Promise<void> {
  let path = root
  for (const part of relative.split('/')) {
    path = join(path, part)
    const info = await lstat(path).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    })
    if (info?.isSymbolicLink() || (info?.isFile() && info.nlink !== 1)) throw new Error('Git metadata aliases prevent safe remote refresh')
  }
}

/**
 * Refresh remote-tracking branches using only one persisted Forge repository.
 * @param workspace - Exact bound managed clone path.
 * @param repository - Persisted Forge owner/repository.
 * @param config - Deployment-owned transport and confinement settings.
 * @param signal - Tool cancellation; every child and the complete operation are bounded.
 * @returns Verified tracking-ref changes after a prepared compare-and-swap transaction; deleted remote branches remain locally retained.
 */
export async function fetchBranches(
  workspace: string, repository: string, config: GitPublicationConfig, signal?: AbortSignal,
): Promise<BranchRefresh> {
  if (!config.confidentialTools) throw new Error('Forge fetch requires confidential repository commands')
  const deadline = AbortSignal.timeout(config.gitPushTimeoutMs)
  const cancellation = signal === undefined ? deadline : AbortSignal.any([signal, deadline])
  const gitDir = await validateManagedClone(workspace, repository, config, cancellation)
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'forge-fetch-')))
  try {
    const remote = join(temporary, 'remote.git')
    const url = `${config.forgejoBaseUrl.replace(/\/$/, '')}/${repository}.git`
    await publicationGit(['init', '--bare', '--template=', remote], config, {}, cancellation)
    await publicationGit([
      '--git-dir', remote, 'fetch', '--no-tags', '--no-recurse-submodules', '--no-auto-maintenance',
      '--', url, 'refs/heads/*:refs/heads/*',
    ], config, transportEnvironment(url, config), cancellation)
    const advertised = await publicationGit([
      '--git-dir', remote, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/',
    ], config, {}, cancellation)
    const branches = advertised.trim() ? advertised.trim().split('\n').map((line) => {
      const match = /^refs\/heads\/(\S+) ([a-f0-9]{40}|[a-f0-9]{64})$/.exec(line)
      const name = match?.[1]
      const commit = match?.[2]
      if (name === undefined || commit === undefined || name === 'HEAD') throw new Error('Remote branch identity is unsupported')
      return { name, commit, ref: `refs/remotes/origin/${name}` }
    }) : []
    if (branches.length > 1000) throw new Error('Remote branch count exceeds the refresh limit')
    // All credentialed work is complete before any editable clone metadata is used.
    if (await validateManagedClone(workspace, repository, config, cancellation) !== gitDir) throw new Error('Managed clone changed during fetch')
    const run = (args: string[], input?: string | Buffer): Promise<string> => sourceGit(workspace, args, config, cancellation, [], input)
    const objects = await readdir(join(gitDir, 'objects'))
    for (const entry of objects) await metadataPath(gitDir, `objects/${entry}`)
    await metadataPath(gitDir, 'refs/remotes/origin')
    await metadataPath(gitDir, 'logs/refs/remotes/origin')
    const previous = new Map<string, string>()
    for (const line of (await run(['for-each-ref', '--format=%(refname) %(objectname) %(symref)', 'refs/remotes/origin/'])).trim().split('\n')) {
      if (!line) continue
      const match = /^(refs\/remotes\/origin\/\S+) ([a-f0-9]{40}|[a-f0-9]{64})(?: (.*))?$/.exec(line)
      const ref = match?.[1]
      const commit = match?.[2]
      if (ref === undefined || commit === undefined) throw new Error('Tracking ref identity is invalid')
      if (match?.[3] && branches.some(branch => branch.ref === ref)) throw new Error('Symbolic tracking refs prevent safe remote refresh')
      previous.set(ref, commit)
    }
    for (const branch of branches) {
      await run(['check-ref-format', branch.ref])
      await metadataPath(gitDir, branch.ref)
      await metadataPath(gitDir, `logs/${branch.ref}`)
    }
    if (branches.length) {
      // Produce bytes with clean private metadata; source configuration never selects a transport/helper.
      const prefix = join(remote, 'forge-import')
      const packId = (await publicationGit(['--git-dir', remote, 'pack-objects', '--revs', prefix],
        config, {}, cancellation, ['git'], `${branches.map(branch => branch.commit).join('\n')}\n`)).trim()
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(packId)) throw new Error('Private import pack identity is invalid')
      const pack = `${prefix}-${packId}.pack`
      if ((await stat(pack)).size > 64 * 1024 * 1024) throw new Error('Remote import pack exceeds the 64 MiB refresh limit')
      await run(['index-pack', '--stdin'], await readFile(pack))
    }
    const updates: string[] = []
    const transaction = ['start', 'option no-deref']
    for (const branch of branches) {
      const old = previous.get(branch.ref)
      if (old === branch.commit) continue
      if (old !== undefined && (await run(['rev-list', '--count', old, `^${branch.commit}`, '--'])).trim() !== '0') {
        throw new Error(`origin/${branch.name} diverged; no tracking refs were updated. Force refresh is unsupported.`)
      }
      transaction.push(`update ${branch.ref} ${branch.commit} ${old ?? '0'.repeat(branch.commit.length)}`)
      updates.push(branch.name)
    }
    if (updates.length) await run(['update-ref', '--stdin'], [...transaction, 'prepare', 'commit', ''].join('\n'))
    const verified = new Map((await run(['for-each-ref', '--format=%(refname) %(objectname) %(symref)', 'refs/remotes/origin/']))
      .trim().split('\n').filter(Boolean).map((line): [string, string] => {
        const [ref = '', commit = '', symref] = line.trim().split(' ')
        return [ref, symref ? '' : commit]
      }))
    if (branches.some(branch => verified.get(branch.ref) !== branch.commit)) throw new Error('Tracking refs changed during refresh; no success was verified')
    return { repository, updated: updates, unchanged: branches.length - updates.length }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

/**
 * Construct the exact bound refresh schema without running any transport.
 * @param refresh - Runtime-owned serialized session binding and refresh operation.
 * @returns The no-argument Forge remote refresh tool.
 */
export function createForgeFetchTool(refresh: (agent: Agent, signal: AbortSignal) => Promise<BranchRefresh>): ToolDefinition {
  return defineTool({
    name: 'forge_fetch',
    description: 'Refresh origin remote-tracking branches for this session’s registered Forge repository. Uses a fixed trusted transport without exposing credentials. Preserves HEAD, index, working files and local branches. No pull, checkout, reset, stash, pruning, force update or arbitrary destination. Divergent tracking refs stop the refresh without updating refs. After fetching, inspect and integrate desired commits explicitly through forge_shell.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      repository: { type: 'string', required: true }, updated: { type: 'array', items: { type: 'string' }, required: true },
      unchanged: { type: 'integer', required: true },
    } }, render: (_args, result) => [{ type: 'text', text: `Verified remote refresh for ${result.repository}. Updated: ${result.updated.join(', ') || 'none'}. Unchanged: ${String(result.unchanged)}. Deleted remote branches are retained locally; development files and branches were not selected for mutation.` }] },
    execute: async (args, exec) => {
      if (Object.keys(args).length !== 0) throw new Error('forge_fetch accepts no destination, branch, force or pruning arguments')
      if (exec.agent === undefined) throw new Error('forge_fetch requires an initiating agent')
      return refresh(exec.agent, exec.signal)
    },
    presentCall: () => ({ card: 'generic', title: 'Refresh remote branches', kind: 'other' }),
  })
}
