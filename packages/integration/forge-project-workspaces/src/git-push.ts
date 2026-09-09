/** Credential-bearing publication runs against clean Git metadata, never repository configuration. */

import { spawn } from 'node:child_process'
import { lstat, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { grantArgs, launcherPath, probeConfidential } from '@deepseek-ai/node-addon-landlock-run'

/** Exact local publication selected before approval. */
export interface BranchPublication {
  readonly workspace: string
  readonly repository: string
  readonly branch: string
  readonly commit: string
  readonly objects: string
}

/** Deployment-owned Git transport settings. */
export interface GitPublicationConfig {
  readonly forgejoBaseUrl: string
  readonly forgejoToken: string
  readonly gitPushTimeoutMs: number
  readonly maxRequestBytes: number
  /** Forge-only confinement of every source-repository Git subprocess. */
  readonly confidentialTools?: boolean
  /** Immutable read roots validated by confidential-tool startup. */
  readonly toolReadRoots?: string[]
}

function baseEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
  }
}

/**
 * Run fixed Git arguments with a bounded, secret-free result and whole-process-group cancellation.
 * @param args - Server-owned arguments; never a model command string.
 * @param config - Deployment deadline and output bounds.
 * @param extra - Explicit credential environment for clean temporary Git metadata only.
 * @param signal - Owning tool cancellation.
 * @param command - Trusted executable prefix; source Git uses the Landlock launcher.
 * @param input - Optional server-generated transaction bytes written to stdin.
 * @returns Captured UTF-8 stdout after successful completion.
 */
export async function publicationGit(
  args: string[], config: GitPublicationConfig,
  extra: NodeJS.ProcessEnv = {}, signal?: AbortSignal, command: readonly string[] = ['git'], input?: string | Buffer,
): Promise<string> {
  if (signal?.aborted) throw new Error('Git publication cancelled')
  const executable = command[0]
  if (executable === undefined) throw new Error('Git publication requires a trusted executable')
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...command.slice(1), ...args], {
      env: { ...baseEnvironment(), ...extra }, detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdin?.on('error', () => { /* Git exit status owns rejected transaction input. */ })
    child.stdin?.end(input)
    const chunks: Buffer[] = []
    let bytes = 0
    let failure: string | undefined
    const stop = (reason: string): void => {
      failure ??= reason
      if (child.pid === undefined) return
      try {
        if (process.platform === 'win32') child.kill('SIGKILL')
        else process.kill(-child.pid, 'SIGKILL')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill('SIGKILL')
      }
    }
    const abort = (): void => { stop('Git publication cancelled') }
    const timer = setTimeout(() => { stop('Git publication timed out') }, config.gitPushTimeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    const capture = (chunk: Buffer, stdout: boolean): void => {
      bytes += chunk.length
      if (bytes > config.maxRequestBytes) stop('Git publication output exceeded its limit')
      else if (stdout) chunks.push(chunk)
    }
    child.stdout.on('data', (chunk: Buffer) => { capture(chunk, true) })
    child.stderr.on('data', (chunk: Buffer) => { capture(chunk, false) })
    child.once('error', () => { failure ??= 'Git publication could not start' })
    child.once('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (failure !== undefined || code !== 0) {
        reject(new Error(failure ?? `Git publication failed (exit ${String(code)}); no success was verified`))
      } else resolve(Buffer.concat(chunks).toString('utf8'))
    })
  })
}

/**
 * Run credential-free repository commands inside Forge's existing child boundary.
 * @param workspace - Canonical managed clone.
 * @param args - Server-owned Git argv.
 * @param config - Validated confinement and timeout settings.
 * @param signal - Owning operation cancellation.
 * @param extraReadRoots - Trusted private object-import directories; never model paths.
 * @param input - Optional server-generated ref transaction.
 * @returns Bounded successful Git stdout.
 */
export async function sourceGit(
  workspace: string, args: string[], config: GitPublicationConfig, signal?: AbortSignal,
  extraReadRoots: string[] = [], input?: string | Buffer,
): Promise<string> {
  if (!config.confidentialTools) return publicationGit(localArguments(workspace, args), config, {}, signal, ['git'], input)
  if (process.platform !== 'linux' || !probeConfidential() || !config.toolReadRoots?.length) {
    throw new Error('Forge source Git requires Linux filesystem and socket-denial enforcement and bounded runtime roots')
  }
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'forge-git-read-')))
  try {
    return await publicationGit(localArguments(workspace, args), config, {
      PATH: '/usr/local/bin:/usr/bin:/bin', HOME: temporary, TMPDIR: temporary, TMP: temporary, TEMP: temporary,
    }, signal, [launcherPath(), ...grantArgs({ confidential: true, readOnly: [...config.toolReadRoots, ...extraReadRoots], readWrite: [workspace, temporary, '/dev/null'] }), '--', 'git'], input)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

function localArguments(workspace: string, args: string[]): string[] {
  return ['--no-replace-objects', '-C', workspace, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args]
}

/**
 * Verify the exact clone and registered origin without consulting credentialed Git.
 * @param workspace - Persisted canonical managed path.
 * @param repository - Persisted owner/repository identity.
 * @param config - Deployment Git origin and command boundary.
 * @param signal - Owning operation cancellation.
 * @returns The verified canonical Git directory.
 */
export async function validateManagedClone(
  workspace: string, repository: string, config: GitPublicationConfig, signal?: AbortSignal,
): Promise<string> {
  const run = (args: string[]): Promise<string> => sourceGit(workspace, args, config, signal)
  if (await realpath(workspace) !== workspace) throw new Error('Managed workspace identity changed')
  const gitDir = (await run(['rev-parse', '--absolute-git-dir'])).trim()
  if (gitDir !== join(workspace, '.git') || await realpath(gitDir) !== gitDir) {
    throw new Error('Forge requires the exact managed clone Git directory')
  }
  if ((await run(['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim() !== gitDir) throw new Error('Shared Git metadata prevents managed repository operations')
  for (const relative of ['commondir', 'objects/info/alternates', 'objects/info/http-alternates']) {
    const exists = await lstat(join(gitDir, relative)).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    })
    if (exists) throw new Error('Shared Git metadata prevents managed repository operations')
  }
  const url = `${config.forgejoBaseUrl.replace(/\/$/, '')}/${repository}.git`
  if ((await run(['config', '--local', '--no-includes', '--get', 'remote.origin.url'])).trim() !== url) {
    throw new Error('Workspace origin does not match its registered Forge repository')
  }
  if ((await run(['rev-parse', '--show-toplevel'])).trim() !== workspace) throw new Error('Managed clone worktree identity changed')
  if (await realpath(join(gitDir, 'objects')) !== join(gitDir, 'objects')) throw new Error('Managed Git object directory escaped its clone')
  return gitDir
}

/**
 * Select the current committed development branch from one trusted catalog binding.
 * @param workspace - Exact canonical registered workspace path.
 * @param repository - Owner/repository from the persisted authenticated catalog.
 * @param config - Deployment Git limits and origin.
 * @param signal - Owning tool cancellation.
 * @returns Immutable publication facts for explicit approval.
 */
export async function preparePublication(
  workspace: string, repository: string, config: GitPublicationConfig, signal?: AbortSignal,
): Promise<BranchPublication> {
  const run = (args: string[]): Promise<string> => sourceGit(workspace, args, config, signal)
  const gitDir = await validateManagedClone(workspace, repository, config, signal)
  const branch = (await run(['symbolic-ref', '--short', 'HEAD'])).trim()
  if (!/^(?:codex|forge)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)) {
    throw new Error('Publish only a codex/ or forge/ development branch; protected branches are not accepted')
  }
  await run(['check-ref-format', `refs/heads/${branch}`])
  if (await run(['status', '--porcelain=v1', '--untracked-files=all'])) {
    throw new Error('Commit or remove pending workspace changes before publication')
  }
  const commit = (await run(['rev-parse', '--verify', 'HEAD^{commit}'])).trim()
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Invalid committed revision')
  const objects = join(gitDir, 'objects')
  if (await realpath(objects) !== objects) throw new Error('Managed Git object directory escaped its clone')
  return { workspace, repository, branch, commit, objects }
}

/**
 * Publish exactly the approved commit without reading credential-bearing repository Git configuration.
 * @param selected - Facts selected before user approval.
 * @param config - Trusted origin, credential and process limits.
 * @param signal - Owning tool cancellation.
 * @returns The verified remote branch revision.
 */
export async function publishBranch(
  selected: BranchPublication, config: GitPublicationConfig, signal?: AbortSignal,
): Promise<string> {
  const current = await preparePublication(selected.workspace, selected.repository, config, signal)
  if (current.branch !== selected.branch || current.commit !== selected.commit || current.objects !== selected.objects) {
    throw new Error('Workspace revision changed after publication approval')
  }
  const temporary = await mkdtemp(join(tmpdir(), 'forge-publish-'))
  try {
    const gitDir = join(temporary, 'repository.git')
    await publicationGit(['init', '--bare', '--template=', gitDir], config, {}, signal)
    await writeFile(join(gitDir, 'objects', 'info', 'alternates'), `${selected.objects}\n`, { mode: 0o600 })
    const url = `${config.forgejoBaseUrl.replace(/\/$/, '')}/${selected.repository}.git`
    const env = transportEnvironment(url, config)
    const run = (args: string[]): Promise<string> => publicationGit(['--git-dir', gitDir, ...args], config, env, signal)
    const head = await run(['ls-remote', '--symref', url, 'HEAD'])
    const defaultBranch = /^ref: refs\/heads\/(.+)\tHEAD$/m.exec(head)?.[1]
    if (defaultBranch === undefined || defaultBranch === selected.branch) {
      throw new Error('Remote default branch is unknown or selected; publication refused')
    }
    await run(['push', '--porcelain', '--no-verify', url, `${selected.commit}:refs/heads/${selected.branch}`])
    const remote = (await run(['ls-remote', '--refs', url, `refs/heads/${selected.branch}`])).trim()
    if (remote !== `${selected.commit}\trefs/heads/${selected.branch}`) {
      throw new Error('Remote branch did not match the approved commit after publication')
    }
    return selected.commit
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

/**
 * Supply credential authority only to fresh, private Git metadata.
 * @param url - Exact registered HTTP(S) repository URL.
 * @param config - Deployment-owned transport credential.
 * @returns Private child environment; never persist or return these values.
 */
export function transportEnvironment(url: string, config: GitPublicationConfig): NodeJS.ProcessEnv {
  const settings: [string, string][] = [
    ['core.hooksPath', '/dev/null'], ['core.fsmonitor', 'false'], ['credential.helper', ''],
    ['protocol.allow', 'never'], ['protocol.http.allow', 'always'], ['protocol.https.allow', 'always'],
    ['http.followRedirects', 'false'], [`http.${url}.extraHeader`, `Authorization: token ${config.forgejoToken}`],
  ]
  const env: NodeJS.ProcessEnv = { GIT_CONFIG_COUNT: String(settings.length) }
  settings.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${String(index)}`] = key
    env[`GIT_CONFIG_VALUE_${String(index)}`] = value
  })
  return env
}

/**
 * Clone a catalog-bound repository with isolated transport configuration and bounded diagnostics.
 * @param path - Exact managed destination selected by the reconciler.
 * @param repository - Validated authenticated catalog owner/repository.
 * @param config - Deployment transport settings and limits.
 * @returns After the clone has completed successfully.
 */
export async function cloneManagedRepository(path: string, repository: string, config: GitPublicationConfig): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), 'forge-clone-'))
  try {
    const url = `${config.forgejoBaseUrl.replace(/\/$/, '')}/${repository}.git`
    await publicationGit(['-C', temporary, 'init', '--template='], config)
    await publicationGit(
      ['-C', temporary, 'clone', '--template=', '--no-recurse-submodules', '--', url, path],
      config, transportEnvironment(url, config),
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
