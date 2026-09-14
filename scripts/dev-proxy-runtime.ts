/** Local development backend ownership and explicit retention of a committed build. */
import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

/** Private, machine-local supervisor configuration; all paths are absolute. */
export interface RecoveryConfig {
  repository: string
  home: string
  state: string
  port: number
  backendPort: number
  trustedHosts: string[]
  node: string
  pnpm: string
  path: string
  startupTimeoutMs: number
  stopTimeoutMs: number
}

/** Operator-confirmed source revision and independently installed runtime. */
interface GoodBuild {
  commit: string
  directory: string
  confirmedAt: string
}

/** Recovery status contains no authentication material or backend log content. */
export interface RecoveryStatus {
  active: 'current' | 'good' | null
  running: boolean
  commit: string | null
  goodCommit: string | null
  error: string | null
}

/** Operations exposed by the independent local proxy. */
export interface RecoveryControls {
  status(): RecoveryStatus
  openPath(): string
  targetPort(): number | undefined
  use(target: 'current' | 'good'): Promise<void>
  markGood(): Promise<void>
  interrupt(): Promise<void>
  close(): Promise<void>
}

interface OwnedProcess {
  child: ChildProcessByStdio<null, Readable, Readable>
  done: Promise<void>
}

/** Publish a private JSON record without exposing a partially written document. */
async function writeRecord(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

/** Track every runnable artifact outside dependency directories, including native addons. */
async function artifacts(root: string): Promise<{ paths: string[]; digest: string }> {
  const hash = createHash('sha256')
  const paths: string[] = []
  async function visit(relative: string, inside: boolean): Promise<void> {
    const entries = await readdir(join(root, relative), { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const path = join(relative, entry.name)
      if (entry.isDirectory()) {
        const selected = inside || entry.name === 'lib' || path === join('apps', 'web', 'dist')
        await visit(path, selected)
      } else if (entry.isFile() && (inside || entry.name.endsWith('.node'))) {
        paths.push(path)
        hash.update(path).update('\0').update(await readFile(join(root, path))).update('\0')
      } else if (inside && entry.isSymbolicLink()) {
        throw new Error(`Runtime artifact is a symlink: ${path}`)
      }
    }
  }
  for (const directory of ['apps', 'packages', 'vendor', 'native']) await visit(directory, false)
  if (!paths.includes(join('apps', 'cli', 'lib', 'bin.js'))) throw new Error('Build the CLI before starting current.')
  return { paths, digest: hash.digest('hex') }
}

/** Owns all children so switching and shutdown await process-tree termination. */
export class LocalBackends implements RecoveryControls {
  private readonly config: RecoveryConfig
  private readonly processes = new Set<OwnedProcess>()
  private backend: OwnedProcess | undefined
  private good: GoodBuild | undefined
  private active: 'current' | 'good' | null = null
  private commit: string | null = null
  private digest: string | undefined
  private failure: string | null = null
  private closing = false
  private interrupted = false
  private launchPath = '/'
  private selected: 'current' | 'good' = 'current'
  private port: number | undefined

  private constructor(config: RecoveryConfig) { this.config = config }

  /** Load retained state before acquiring a listener or spawning a backend.
   * @param config - validated machine-local configuration.
   * @returns a supervisor with no active backend.
   */
  static async open(config: RecoveryConfig): Promise<LocalBackends> {
    const owner = new LocalBackends(config)
    try {
      const value: unknown = JSON.parse(await readFile(join(config.state, 'good.json'), 'utf8'))
      if (typeof value !== 'object' || value === null
        || !('commit' in value) || typeof value.commit !== 'string' || !/^[a-f0-9]{40}$/u.test(value.commit)
        || !('directory' in value) || typeof value.directory !== 'string'
        || !('confirmedAt' in value) || typeof value.confirmedAt !== 'string'
        || resolve(value.directory) !== join(config.state, 'builds', basename(value.directory))
        || !new RegExp(`^${value.commit}-[a-f0-9-]{36}$`, 'u').test(basename(value.directory))) {
        throw new Error('Invalid retained build record; inspect good.json.')
      }
      owner.good = { commit: value.commit, directory: value.directory, confirmedAt: value.confirmedAt }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    try {
      const selected: unknown = JSON.parse(await readFile(join(config.state, 'selected.json'), 'utf8'))
      if (selected !== 'current' && selected !== 'good') throw new Error('Invalid selected backend record.')
      owner.selected = selected
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    return owner
  }

  /** Return the last explicit backend selection for supervisor restarts. */
  initialTarget(): 'current' | 'good' { return this.selected }

  /** Return the private authentication handoff path, only for authenticated recovery callers. */
  openPath(): string { return this.launchPath }

  /** Return the port announced by this supervisor's ready child, never an unrelated listener. */
  targetPort(): number | undefined { return this.port }

  /** Return source identity and observed process liveness, without probing task success. */
  status(): RecoveryStatus {
    return { active: this.active, running: this.backend !== undefined, commit: this.commit,
      goodCommit: this.good?.commit ?? null, error: this.failure }
  }

  private assertContinuing(): void {
    if (this.closing || this.interrupted) throw new Error('Recovery operation was interrupted.')
  }

  private spawn(command: string, args: string[], cwd: string, log: string): OwnedProcess {
    this.assertContinuing()
    const output = createWriteStream(join(this.config.state, log), { flags: 'a', mode: 0o600 })
    const child = spawn(command, args, {
      cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: this.config.path, DSH_HOME: this.config.home },
    })
    child.stdout.pipe(output, { end: false })
    child.stderr.pipe(output, { end: false })
    let failure: Error | undefined
    const done = new Promise<void>((resolveDone, reject) => {
      child.once('error', (error) => { failure = error })
      child.once('close', (code, signal) => {
        output.end()
        if (failure !== undefined) reject(failure)
        else if (code === 0) resolveDone()
        else reject(new Error(`${command} exited (${String(code ?? signal)}); see ${log}.`))
      })
    })
    const owned = { child, done }
    this.processes.add(owned)
    output.once('error', (error) => {
      failure = error
      if (this.processes.has(owned)) {
        void this.stop(owned).catch((stopError: unknown) => { console.error(String(stopError)) })
      }
    })
    // Callers observe failures through done; this observer only releases ownership.
    void done.then(() => this.processes.delete(owned), () => this.processes.delete(owned))
    return owned
  }

  private async stop(owned: OwnedProcess): Promise<void> {
    const pid = owned.child.pid
    if (pid === undefined) { await Promise.allSettled([owned.done]); return }
    const signal = (name: NodeJS.Signals): void => {
      try { process.kill(-pid, name) } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
      }
    }
    signal('SIGTERM')
    const timer = setTimeout(() => { signal('SIGKILL') }, this.config.stopTimeoutMs)
    try { await Promise.allSettled([owned.done]) } finally { clearTimeout(timer); signal('SIGKILL') }
  }

  private async git(args: string[], cwd = this.config.repository): Promise<string> {
    const owned = this.spawn('git', args, cwd, 'retain.log')
    let output = ''
    owned.child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk })
    await owned.done
    return output.trim()
  }

  /** Stop the previous backend, build current if selected, then launch through dsh web.
   * @param target - development checkout or the retained committed build.
   */
  async use(target: 'current' | 'good'): Promise<void> {
    const targetBuild = target === 'good' ? this.good : { directory: this.config.repository, commit: null }
    if (targetBuild === undefined) throw new Error('No last-good build has been marked.')
    this.interrupted = false
    await writeRecord(join(this.config.state, 'selected.json'), target)
    this.selected = target
    const previous = this.backend
    this.backend = undefined
    this.active = null
    this.commit = null
    this.port = undefined
    this.digest = undefined
    this.failure = null
    if (previous !== undefined) await this.stop(previous)
    try {
      const directory = targetBuild.directory
      if (target === 'current') {
        const before = await this.git(['rev-parse', 'HEAD'])
        const clean = await this.git(['status', '--porcelain']) === ''
        await this.spawn(this.config.pnpm, ['run', 'build'], directory, 'build.log').done
        if (clean && await this.git(['status', '--porcelain']) === '' && before === await this.git(['rev-parse', 'HEAD'])) {
          this.commit = before
          this.digest = (await artifacts(directory)).digest
        }
      } else {
        this.commit = targetBuild.commit
      }
      const args = [join(directory, 'apps/cli/lib/bin.js'), '--profile', 'web', '--port', String(this.config.backendPort), '--no-open']
      if (this.config.trustedHosts.length > 0) args.push('--trusted-host', ...this.config.trustedHosts)
      const backend = this.spawn(this.config.node, args, this.config.repository, 'backend.log')
      this.backend = backend
      void backend.done.catch((error: unknown) => {
        if (this.backend === backend && !this.closing) this.failure = String(error)
      }).finally(() => {
        if (this.backend === backend) this.backend = undefined
      })
      await new Promise<void>((resolveReady, reject) => {
        let output = ''
        const timer = setTimeout(() => { finish(new Error('Backend startup timed out; see backend.log.')) }, this.config.startupTimeoutMs)
        const onData = (chunk: string): void => {
          output = (output + chunk).slice(-16_384)
          const match = output.match(/(?:^|\n)dsh web: (http:\/\/127\.0\.0\.1:(\d+)\/[^\s]*)/u)
          if (match?.[1] !== undefined) {
            const port = Number(match[2])
            if (port < 1 || port > 65535 || (this.config.backendPort !== 0 && port !== this.config.backendPort)) return
            this.port = port
            this.launchPath = `/${new URL(match[1]).search}`
            finish()
          }
        }
        const finish = (error?: Error): void => {
          clearTimeout(timer)
          backend.child.stdout.off('data', onData)
          if (error === undefined) resolveReady()
          else reject(error)
        }
        backend.child.stdout.setEncoding('utf8').on('data', onData)
        void backend.done.then(() => { finish(new Error('Backend exited.')) }, (error: unknown) => { finish(error instanceof Error ? error : new Error(String(error))) })
      })
      this.assertContinuing()
      this.active = target
    } catch (error) {
      const backend = this.backend
      this.backend = undefined
      if (backend !== undefined) await this.stop(backend)
      this.failure = String(error)
      throw error
    }
  }

  /** Retain the exact running artifacts after the operator confirms a real code edit. */
  async markGood(): Promise<void> {
    const commit = this.commit
    if (this.active !== 'current' || this.backend === undefined || commit === null || this.digest === undefined) {
      throw new Error('Start current from a clean committed checkout, perform a code edit, then mark it good.')
    }
    const runtime = await artifacts(this.config.repository)
    if (await this.git(['rev-parse', 'HEAD']) !== commit || await this.git(['status', '--porcelain']) !== '') {
      throw new Error('The checkout changed since startup; commit changes and restart current before marking good.')
    }
    if (runtime.digest !== this.digest) throw new Error('Runtime artifacts changed since startup; restart current before marking good.')
    if (this.good?.commit === commit) return
    const directory = join(this.config.state, 'builds', `${commit}-${randomUUID()}`)
    await mkdir(join(this.config.state, 'builds'), { recursive: true })
    // Each clone has its own Git objects and dependency installation; source checkout cleanup cannot invalidate it.
    await this.git(['clone', '--no-hardlinks', '--no-checkout', '--local', this.config.repository, directory])
    try {
      await this.git(['checkout', '--detach', commit], directory)
      await this.spawn(this.config.pnpm, ['install', '--frozen-lockfile'], directory, 'retain.log').done
      for (const path of runtime.paths) {
        await mkdir(resolve(directory, path, '..'), { recursive: true })
        await cp(join(this.config.repository, path), join(directory, path))
      }
      if ((await artifacts(this.config.repository)).digest !== runtime.digest
        || (await artifacts(directory)).digest !== runtime.digest
        || await this.git(['rev-parse', 'HEAD']) !== commit || await this.git(['status', '--porcelain']) !== '') {
        throw new Error('Runtime changed while retaining it; restart current and mark again.')
      }
      this.assertContinuing()
      if (!this.status().running) throw new Error('Backend stopped while retaining the build.')
      const good = { commit, directory, confirmedAt: new Date().toISOString() }
      await writeRecord(join(this.config.state, 'good.json'), good)
      this.good = good
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  /** Terminate every owned backend or preparation process and await exit. */
  async close(): Promise<void> {
    this.closing = true
    await this.interrupt()
  }

  /** Interrupt preparation or startup before an explicit fallback; new work waits for the next selection. */
  async interrupt(): Promise<void> {
    this.interrupted = true
    this.backend = undefined
    await Promise.all([...this.processes].map(child => this.stop(child)))
  }
}
