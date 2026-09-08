/**
 * Authenticated Forge project-catalog reconciliation for the Web workspace
 * registry. Forge supplies identity and repository ownership; this plugin
 * materializes and registers the corresponding Harness directories.
 * @module @deepseek-ai/dsh-forge-project-workspaces
 */

import { timingSafeEqual } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, readdir, realpath, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DirectoryPicker } from '@deepseek-ai/dsh-host-directory-picker'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-user-approval'
import { confidentialToolGuard, registerConfidentialTools } from './confidential-tools.ts'
import { cloneManagedRepository, preparePublication, publishBranch } from './git-push.ts'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-host-webserver'

declare module '@deepseek-ai/dsh-host-directory-picker' {
  interface DirectoryPickerCapabilities {
    'forge-managed': { kind: 'forge-managed' }
  }
}

/** Closed picker seam: Forge catalog registration supplies directories. */
class ManagedDirectoryPicker extends DirectoryPicker {
  private readonly managed = Object.freeze({ kind: 'forge-managed' as const })
  /** Return a stable capability with no host browsing or adoption operations. */
  capability(): { kind: 'forge-managed' } { return this.managed }
}

const execFileAsync = promisify(execFile)

const PROJECT_SLUG = /^[a-z0-9][a-z0-9-]{1,38}$/
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/

/** Cordis services required by the reconciler. */
export const inject = ['webServer', 'workspaceRegistry']

/** Deployment configuration for the Forge-owned project catalog route. */
export interface Config {
  /** Bearer token required by the internal Hub request. */
  token: string
  /** Exact HTTP path receiving catalog replacement requests. */
  routePath: string
  /** Absolute directory containing only Forge-managed workspaces. */
  workspaceRoot: string
  /** Internal Forgejo origin used to clone a registered repository. */
  forgejoBaseUrl: string
  /** Forgejo token sent only through the Git child process environment. */
  forgejoToken: string
  /** Trusted catalog binding file outside all managed workspaces; enables approved branch publication. */
  publicationStateFile?: string
  /** Deadline in milliseconds for each bounded publication Git command. */
  gitPushTimeoutMs: number
  /** Deadline in milliseconds for each local Git identity read. */
  gitReadTimeoutMs: number
  /** Explicit Forge-only model confidentiality: exclusive confined shell and approved publication. */
  confidentialTools?: boolean
  /** Supply a closed directory-picker capability for catalog-managed Web hosts. */
  managedDirectoryPicker?: boolean
  /** Immutable runtime/system read roots; excludes workspace parents and private Harness state. */
  toolReadRoots?: string[]
  /** Maximum accepted JSON request bytes and local Git output bytes. */
  maxRequestBytes: number
}

export const Config: z<Config> = z.object({
  token: z.string().required(),
  routePath: z.string().default('/forge/v1/projects/sync'),
  workspaceRoot: z.string().default('/workspaces/forge'),
  forgejoBaseUrl: z.string().default('http://forgejo:3000'),
  forgejoToken: z.string().required(),
  publicationStateFile: z.string(),
  gitPushTimeoutMs: z.number().min(1).default(60_000),
  gitReadTimeoutMs: z.number().min(1).default(5000),
  confidentialTools: z.boolean().default(false),
  managedDirectoryPicker: z.boolean().default(false),
  toolReadRoots: z.array(z.string()).default([]),
  maxRequestBytes: z.number().min(1).max(4 * 1024 * 1024).default(1024 * 1024),
})

/** One Forge-owned project row accepted by the replacement endpoint. */
export interface ForgeProjectWorkspaceInput {
  project_id: string
  slug: string
  title: string
  repository: string | null
}

interface ReconciledProject {
  project_id: string
  slug: string
  workspace_id: string
  path: string
  repository: string | null
  materialized: 'created' | 'existing'
}

interface SyncResponse {
  protocol: 'dsh-forge-project-workspaces/v1'
  projects: ReconciledProject[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    forgeProjectWorkspaces: ForgeProjectWorkspaces
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(bytes.length),
    'cache-control': 'no-store',
  })
  res.end(bytes)
}

function safeEqual(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false
  const left = Buffer.from(actual)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

/**
 * Parse and validate one complete Forge catalog replacement.
 *
 * @param value - Candidate request body received from Forge Hub.
 * @returns Projects normalized for managed-workspace reconciliation.
 */
export function parseCatalog(value: unknown): ForgeProjectWorkspaceInput[] {
  const root = asObject(value, 'request')
  if (!Array.isArray(root.projects)) throw new Error('request.projects must be an array')
  if (root.projects.length > 500) throw new Error('request.projects exceeds the 500-project limit')
  const slugs = new Set<string>()
  const projectIds = new Set<string>()
  return root.projects.map((candidate, index) => {
    const row = asObject(candidate, `request.projects[${String(index)}]`)
    const slug = typeof row.slug === 'string' ? row.slug : ''
    const projectId = typeof row.project_id === 'string' ? row.project_id : ''
    const title = typeof row.title === 'string' ? row.title.trim() : ''
    const repository = row.repository === null ? null : typeof row.repository === 'string' ? row.repository : ''
    if (!PROJECT_SLUG.test(slug)) throw new Error(`invalid project slug at index ${String(index)}`)
    if (projectId !== `PROJECT:${slug}`) throw new Error(`project_id must equal PROJECT:${slug}`)
    if (title.length === 0 || title.length > 200) throw new Error(`invalid project title at index ${String(index)}`)
    if (repository !== null && !REPOSITORY.test(repository)) {
      throw new Error(`invalid Forgejo repository at index ${String(index)}`)
    }
    if (slugs.has(slug) || projectIds.has(projectId)) throw new Error(`duplicate Forge project ${projectId}`)
    slugs.add(slug)
    projectIds.add(projectId)
    return { project_id: projectId, slug, title, repository }
  })
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function repositoryUrl(repository: string, config: Config): string {
  const [owner, name] = repository.split('/') as [string, string]
  return `${config.forgejoBaseUrl.replace(/\/$/, '')}/${encodeURIComponent(owner)}/${encodeURIComponent(name)}.git`
}

async function observedRepository(path: string, config: Config): Promise<string | null> {
  if (!await pathExists(join(path, '.git'))) return null
  // Local metadata reads never receive provider or repository credentials.
  const env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
  let origin: string
  try {
    const result = await execFileAsync('git', ['-C', path, 'config', '--local', '--no-includes', '--get', 'remote.origin.url'], {
      env, timeout: config.gitReadTimeoutMs, maxBuffer: config.maxRequestBytes,
    })
    origin = result.stdout.trim()
    const top = await execFileAsync('git', ['-C', path, 'rev-parse', '--show-toplevel'], {
      env, timeout: config.gitReadTimeoutMs, maxBuffer: config.maxRequestBytes,
    })
    if (await realpath(top.stdout.trim()) !== path) throw new Error('repository root mismatch')
  } catch {
    throw new Error(`workspace ${path} has no readable Git origin`)
  }
  const prefix = `${config.forgejoBaseUrl.replace(/\/$/, '')}/`
  const repository = origin.startsWith(prefix) ? origin.slice(prefix.length).replace(/\.git$/, '') : ''
  if (!REPOSITORY.test(repository) || origin !== repositoryUrl(repository, config)) {
    throw new Error(`workspace ${path} is not linked to the configured Forgejo origin`)
  }
  return repository
}

async function cloneRepository(path: string, repository: string, config: Config): Promise<'created' | 'existing'> {
  if (await pathExists(join(path, '.git'))) {
    if (await observedRepository(path, config) !== repository) {
      throw new Error(`workspace ${path} is linked to a different Forgejo repository`)
    }
    return 'existing'
  }
  const exists = await pathExists(path)
  if (exists && (await readdir(path)).length > 0) {
    throw new Error(`workspace ${path} is non-empty but is not a Git repository`)
  }
  await mkdir(resolve(path, '..'), { recursive: true })
  await cloneManagedRepository(path, repository, config)
  return 'created'
}

/** Test override point for the external Git materializer. */
export const internals = { cloneRepository }

/** Forge-owned catalog reconciler and authenticated HTTP route owner. */
export class ForgeProjectWorkspaces extends Service {
  static Config = Config
  static inject = inject

  private tail: Promise<void> = Promise.resolve()
  private managedPaths = new Set<string>()
  private canonicalWorkspaceRoot!: string
  private publicationBindings = new Map<string, ForgeProjectWorkspaceInput>()
  private readonly publicationAbort = new AbortController()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'forgeProjectWorkspaces')
    if (config.token.length < 16) throw new Error('forge-project-workspaces: token must contain at least 16 characters')
    if (config.forgejoToken.length < 16) throw new Error('forge-project-workspaces: Forgejo token must contain at least 16 characters')
    if (!isAbsolute(config.workspaceRoot)) throw new Error('forge-project-workspaces: workspaceRoot must be absolute')
    if (!/^\/[A-Za-z0-9._/-]*[A-Za-z0-9._-]$/.test(config.routePath)) {
      throw new Error('forge-project-workspaces: routePath must be absolute without a trailing slash')
    }
  }

  /**
   * Current managed directory paths for invariant inspection.
   * @returns a stable snapshot of the reconciler-owned paths.
   */
  managed(): readonly string[] {
    return [...this.managedPaths]
  }

  async [Service.init](): Promise<void> {
    if (this.config.managedDirectoryPicker) this.ctx.plugin(ManagedDirectoryPicker)
    if (this.config.confidentialTools) {
      const tools = this.ctx.get('tools')
      if (tools === undefined) throw new Error('Forge confidential tools require the tool registry')
      this.ctx.effect(() => tools.guard(exec => confidentialToolGuard(exec)
        ?? (tools.get(exec.name, exec.agent) !== tools.get(exec.name) ? 'Forge tool implementation cannot be replaced by a session preset' : undefined)), 'forgeConfidentialTools.guard')
    }
    await mkdir(this.config.workspaceRoot, { recursive: true })
    this.canonicalWorkspaceRoot = await realpath(this.config.workspaceRoot)
    if (this.config.publicationStateFile !== undefined) await this.initializePublication()
    if (this.config.confidentialTools) {
      if (this.config.publicationStateFile === undefined) throw new Error('Forge confidential tools require persisted repository bindings')
      await registerConfidentialTools(this.ctx, {
        readRoots: this.config.toolReadRoots ?? [], workspaceRoot: this.canonicalWorkspaceRoot,
        privateStateFile: this.config.publicationStateFile,
      }, agent => this.boundRepository(agent).path)
    }
    const unregister = this.ctx.webServer.register({
      kind: 'exact',
      path: this.config.routePath,
      handler: (req, res) => this.handle(req, res),
    })
    this.ctx.effect(() => unregister, 'forgeProjectWorkspaces.route')
  }


  private async initializePublication(): Promise<void> {
    const file = this.config.publicationStateFile
    if (file === undefined) return
    if (!isAbsolute(file) || resolve(file) === this.canonicalWorkspaceRoot || resolve(file).startsWith(`${this.canonicalWorkspaceRoot}/`)) {
      throw new Error('Publication catalog state must be absolute and outside managed workspaces')
    }
    await mkdir(resolve(file, '..'), { recursive: true })
    const parent = await realpath(resolve(file, '..'))
    if (parent === this.canonicalWorkspaceRoot || parent.startsWith(`${this.canonicalWorkspaceRoot}/`)
      || (await pathExists(file) && await realpath(file) !== resolve(file))) {
      throw new Error('Publication catalog state resolves inside managed workspaces or through a symlink')
    }
    const origin = new URL(this.config.forgejoBaseUrl)
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
      throw new Error('Forgejo publication requires an HTTP(S) origin without credentials or path')
    }
    if (process.platform === 'win32') throw new Error('Forge publication requires POSIX process-group isolation')
    if (await pathExists(file)) {
      if ((await stat(file)).size > this.config.maxRequestBytes) throw new Error('Publication catalog exceeds its byte limit')
      const saved: unknown = JSON.parse(await readFile(file, 'utf8'))
      const object = asObject(saved, 'publication catalog')
      if (object.protocol !== 'forge-publication-catalog/v1') throw new Error('Unsupported publication catalog')
      this.publicationBindings = new Map(parseCatalog(object).map(project => [this.managedPath(project.slug), project]))
    }
    const tools = this.ctx.get('tools')
    const approval = this.ctx.get('approval')
    if (tools === undefined || approval === undefined) throw new Error('Forge publication requires tools and approval services')
    this.ctx.effect(() => tools.register(defineTool({
      name: 'forge_push_branch',
      description: 'Publish the current committed codex/ or forge/ development branch to this session workspace’s registered Forge repository. First run tests, inspect the diff, and commit through the existing shell tools. Requires a clean clone and explicit approval. Refuses the remote default branch, force updates, tags, or deletions; Forgejo enforces additional branch protection. The result verifies the remote commit; open that branch in Forgejo to request review.',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          repository: { type: 'string', required: true }, branch: { type: 'string', required: true },
          commit: { type: 'string', required: true },
        } },
        render: (_args, result) => [{ type: 'text', text: `Published ${result.repository} branch ${result.branch} at ${result.commit}. Remote revision verified.` }],
      },
      execute: async (args, exec) => {
        if (Object.keys(args).length !== 0) throw new Error('Forge publication accepts no branch, destination, or force arguments')
        if (exec.agent === undefined) throw new Error('Forge publication requires an initiating agent')
        return this.pushCurrentBranch(exec.agent, exec.callId, exec.signal)
      },
      presentCall: () => ({ card: 'generic', title: 'Publish development branch', kind: 'other' }),
    })), 'forgeProjectWorkspaces.pushTool')
    this.ctx.effect(() => async () => {
      this.publicationAbort.abort()
      await this.tail
    }, 'forgeProjectWorkspaces.publication')
  }

  private boundRepository(agent: Agent): { path: string; project: ForgeProjectWorkspaceInput } {
    const path = agent.session.header.cwd
    const workspace = this.ctx.workspaceRegistry.list()
      .find(item => item.path === path && item.sessionIds.includes(agent.session.id))
    const project = path === undefined ? undefined : this.publicationBindings.get(path)
    if (workspace === undefined || project?.repository === null || project === undefined) {
      throw new Error('This session has no persisted Forge repository binding; synchronize its project catalog first')
    }
    return { path: workspace.path, project }
  }

  private async pushCurrentBranch(
    agent: Agent, callId: CallId, signal?: AbortSignal,
  ): Promise<{ repository: string; branch: string; commit: string }> {
    const cancellation = signal === undefined ? this.publicationAbort.signal : AbortSignal.any([signal, this.publicationAbort.signal])
    const { path, project } = this.boundRepository(agent)
    if (project.repository === null) throw new Error('This Forge project has no repository')
    const selected = await preparePublication(path, project.repository, this.config, cancellation)
    const approval = this.ctx.get('approval')
    if (approval === undefined) throw new Error('Repository approval service is unavailable')
    const outcome = await approval.request({
      agent, callId, toolName: 'forge_push_branch', signal: cancellation,
      reason: `Publish ${selected.commit} to ${selected.repository} branch ${selected.branch}. This updates the remote development branch.`,
    })
    if (outcome !== 'allowed-once') throw new Error('Repository publication was not approved')
    return this.serialize(async () => {
      const current = this.boundRepository(agent)
      if (current.path !== selected.workspace || current.project.repository !== selected.repository) {
        throw new Error('Forge repository binding changed after publication approval')
      }
      const commit = await publishBranch(selected, this.config, cancellation)
      return { repository: selected.repository, branch: selected.branch, commit }
    })
  }

  private authorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined
    return safeEqual(token, this.config.token)
  }

  private async readJson(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const raw of req) {
      const chunk: Buffer = Buffer.isBuffer(raw)
        ? Buffer.from(raw)
        : Buffer.from(raw as Uint8Array)
      size += chunk.length
      if (size > this.config.maxRequestBytes) throw new Error('request body is too large')
      chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.authorized(req)) {
      json(res, 401, { error: 'unauthorized' })
      return
    }
    if (req.method === 'GET') {
      try {
        json(res, 200, await this.serialize(() => this.catalog()))
      } catch (error) {
        json(res, 422, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    if (req.method !== 'PUT') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    try {
      const projects = parseCatalog(await this.readJson(req))
      const response = await this.serialize(() => this.reconcile(projects))
      json(res, 200, response)
    } catch (error) {
      json(res, 422, { error: error instanceof Error ? error.message : String(error) })
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }

  private managedPath(slug: string): string {
    const path = resolve(this.canonicalWorkspaceRoot, slug)
    const rel = relative(this.canonicalWorkspaceRoot, path)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`project ${slug} escaped the workspace root`)
    return path
  }

  private async catalog(): Promise<SyncResponse> {
    const projects: ReconciledProject[] = []
    for (const workspace of this.ctx.workspaceRegistry.list()) {
      const slug = relative(this.canonicalWorkspaceRoot, workspace.path)
      if (!PROJECT_SLUG.test(slug)) continue
      if (projects.length >= 500) throw new Error('managed catalog exceeds the 500-project limit')
      if (workspace.path !== this.managedPath(slug) || await realpath(workspace.path) !== workspace.path) {
        throw new Error(`workspace ${workspace.path} does not resolve to its exact Forge-managed identity`)
      }
      projects.push({
        project_id: `PROJECT:${slug}`, slug, workspace_id: String(workspace.id), path: workspace.path,
        repository: await observedRepository(workspace.path, this.config), materialized: 'existing',
      })
      if (Buffer.byteLength(JSON.stringify({ protocol: 'dsh-forge-project-workspaces/v1', projects })) > this.config.maxRequestBytes) {
        throw new Error('managed catalog exceeds the response byte limit')
      }
    }
    const response: SyncResponse = { protocol: 'dsh-forge-project-workspaces/v1', projects }
    if (Buffer.byteLength(JSON.stringify(response)) > this.config.maxRequestBytes) {
      throw new Error('managed catalog exceeds the response byte limit')
    }
    return response
  }

  private async materialize(project: ForgeProjectWorkspaceInput, path: string): Promise<'created' | 'existing'> {
    if (await pathExists(path) && await realpath(path) !== path) {
      throw new Error(`workspace ${path} does not resolve to its exact Forge-managed identity`)
    }
    if (project.repository !== null) return internals.cloneRepository(path, project.repository, this.config)
    if (await observedRepository(path, this.config) !== null) {
      throw new Error(`workspace ${path} has a repository but the Forge project does not`)
    }
    const existed = await pathExists(path)
    await mkdir(path, { recursive: true })
    return existed ? 'existing' : 'created'
  }

  private async reconcile(projects: ForgeProjectWorkspaceInput[]): Promise<SyncResponse> {
    const desired = new Set(projects.map(project => this.managedPath(project.slug)))
    const rows: Array<{ project: ForgeProjectWorkspaceInput; workspace: Workspace; materialized: 'created' | 'existing' }> = []
    for (const project of projects) {
      const path = this.managedPath(project.slug)
      const materialized = await this.materialize(project, path)
      const canonicalPath = await realpath(path)
      if (canonicalPath !== path) {
        throw new Error(`workspace ${path} does not resolve to its exact Forge-managed identity`)
      }
      const workspace = await this.ctx.workspaceRegistry.create(canonicalPath, project.title)
      if (workspace.title !== project.title) await workspace.setTitle(project.title)
      rows.push({ project, workspace, materialized })
    }

    const managedPrefix = `${this.canonicalWorkspaceRoot}/`
    for (const workspace of this.ctx.workspaceRegistry.list()) {
      if (workspace.path.startsWith(managedPrefix) && !desired.has(workspace.path)) {
        await this.ctx.workspaceRegistry.delete(workspace.id)
      }
    }

    let before: Workspace['id'] | undefined
    for (const row of [...rows].reverse()) {
      await this.ctx.workspaceRegistry.insertBefore(row.workspace.id, before)
      before = row.workspace.id
    }
    if (this.config.publicationStateFile !== undefined) {
      const saved = JSON.stringify({ protocol: 'forge-publication-catalog/v1', projects })
      if (Buffer.byteLength(saved) > this.config.maxRequestBytes) throw new Error('Publication catalog exceeds its byte limit')
      await mkdir(resolve(this.config.publicationStateFile, '..'), { recursive: true })
      await writeFileAtomic(this.config.publicationStateFile, saved, { mode: 0o600 })
      this.publicationBindings = new Map(projects.map(project => [this.managedPath(project.slug), project]))
    }
    this.managedPaths = desired
    return {
      protocol: 'dsh-forge-project-workspaces/v1',
      projects: rows.map(({ project, workspace, materialized }) => ({
        project_id: project.project_id,
        slug: project.slug,
        workspace_id: String(workspace.id),
        path: workspace.path,
        repository: project.repository,
        materialized,
      })),
    }
  }
}

/** Mount the authenticated Forge project workspace reconciler. */
export function apply(ctx: Context, config: Config): void {
  new ForgeProjectWorkspaces(ctx, config)
}

export default ForgeProjectWorkspaces
