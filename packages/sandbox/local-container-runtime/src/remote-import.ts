/** Sandbox-only remote cloning and bounded transfer into environment-owned repositories. @module */
import { mkdir, mkdtemp, rename, rm, writeFile, lstat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { LocalContainerRuntime } from './index.ts'
import { validateGitRemote } from './git-authorization.ts'
import { workspaceGit } from './workspace-git.ts'
import type { WorkspaceLimits } from './workspace-git.ts'
import type { EnvironmentRepository } from './environment-types.ts'

const CLONE = String.raw`
import os,sys,tempfile,subprocess,json,base64
remote,limit,deadline=sys.argv[1],int(sys.argv[2]),int(sys.argv[3])
env=dict(os.environ,GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_GLOBAL='/dev/null',GIT_TERMINAL_PROMPT='0')
with tempfile.TemporaryDirectory(prefix='dsh-remote-') as directory:
    def git(*args):
        result=subprocess.run(['git','-c','core.hooksPath=/dev/null','-c','protocol.allow=never','-c','protocol.https.allow=always',*args],cwd=directory,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=deadline)
        if result.returncode: raise ValueError('approved remote clone failed; check repository access and sandbox capacity')
        return result.stdout
    git('clone','--no-checkout','--no-recurse-submodules','--',remote,'repository')
    directory+='/repository'
    head=git('rev-parse','HEAD').decode().strip()
    branch=git('branch','--show-current').decode().strip()
    bundle=git('bundle','create','-','HEAD')
    if len(bundle)>limit: raise ValueError('remote repository exceeds the workspace transfer bound')
    print(json.dumps(dict(head=head,branch=branch,bundle=base64.b64encode(bundle).decode()),separators=(',',':')))
`

/** Clone only after approval; caller serializes publication of the trusted destination.
 * @param runtime - initiating workspace runtime with current environment credential issuance.
 * @param repository - trusted environment destination and canonical approved URL.
 * @param limits - host validation and transfer resource bounds.
 * @param maxOutputBytes - complete sandbox response cap.
 * @param signal - request cancellation; cancellation terminates the clone process.
 */
export async function cloneEnvironmentRepository(
  runtime: LocalContainerRuntime, repository: EnvironmentRepository, limits: WorkspaceLimits, maxOutputBytes: number, signal: AbortSignal,
): Promise<void> {
  validateGitRemote({ ...repository, credentialTimeoutMs: repository.credentialTimeoutMs })
  signal.throwIfAborted()
  try {
    const info = await lstat(repository.source)
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw new Error('managed repository destination is not a private directory')
    return
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const cancellation = AbortSignal.any([signal, AbortSignal.timeout(limits.timeoutMs)])
  const process = await runtime.createProcess({ argv: ['/usr/bin/python3', '-c', CLONE, repository.url, String(limits.maxBytes), String(Math.ceil(limits.timeoutMs / 1000))],
    cwd: '/workspace', environment: {}, tty: true, rows: 24, cols: 80, stdin: false, signal: cancellation })
  const abort = () => { process.stream.destroy(new Error('remote clone cancelled or timed out')) }
  cancellation.addEventListener('abort', abort, { once: true })
  let response: unknown
  try {
    cancellation.throwIfAborted()
    const chunks: Uint8Array[] = []; let size = 0
    for await (const chunk of process.stream) {
      cancellation.throwIfAborted()
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > maxOutputBytes) throw new Error('remote clone response exceeds its bound')
      chunks.push(new Uint8Array(bytes))
    }
    const result = await process.done
    cancellation.throwIfAborted()
    if (result.exitCode !== 0) throw new Error('approved remote clone failed; check repository access and sandbox capacity')
    response = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } finally { cancellation.removeEventListener('abort', abort); await process.terminate() }
  if (typeof response !== 'object' || response === null || !('head' in response) || typeof response.head !== 'string' || !/^[a-f0-9]{40}$/u.test(response.head)
    || !('branch' in response) || typeof response.branch !== 'string' || response.branch.length === 0
    || !('bundle' in response) || typeof response.bundle !== 'string') throw new Error('invalid remote clone response')
  const bundle = Buffer.from(response.bundle, 'base64')
  if (bundle.length > limits.maxBytes || bundle.toString('base64') !== response.bundle) throw new Error('invalid remote clone bundle')
  await mkdir(dirname(repository.source), { recursive: true, mode: 0o700 })
  const staging = await mkdtemp(join(dirname(repository.source), '.clone-'))
  try {
    const file = join(staging, 'input.bundle'); await writeFile(file, bundle, { mode: 0o600 })
    const checkout = join(staging, 'repository'); await mkdir(checkout, { mode: 0o700 })
    const git = async (...args: string[]) => workspaceGit(checkout, args, limits)
    await git('check-ref-format', '--branch', response.branch)
    await git('init', '--template=', `--initial-branch=${response.branch}`)
    await git('bundle', 'verify', file)
    if ((await git('bundle', 'list-heads', file)).toString().trim() !== `${response.head} HEAD`) throw new Error('remote clone bundle does not match its starting revision')
    await git('-c', 'fetch.fsckObjects=true', 'bundle', 'unbundle', file)
    await git('fsck', '--full', '--strict', '--no-reflogs')
    await git('update-ref', 'HEAD', response.head)
    await git('reset', '--hard', response.head)
    await git('remote', 'add', 'origin', repository.url)
    cancellation.throwIfAborted()
    await rename(checkout, repository.source)
  } finally { await rm(staging, { recursive: true, force: true }) }
}
