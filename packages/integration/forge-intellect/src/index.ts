/** Native Forge Intellect verification coordinated from a running dsh profile. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as value } from 'zod'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'
import { agentModelTargetId } from '@deepseek-ai/dsh-agent-default-model'
import { ReasoningEffortId, type ToolCallId } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { JobId, JobOutcome } from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-user-approval'
import { openBridge } from './bridge.ts'
import { reviewPacket } from './reviewer.ts'
import { planInputSchema, readPlan, planDigest, runSchema, type Plan, type PlanInput, type RunRecord } from './plan.ts'

export type { Plan, PlanInput, RunRecord } from './plan.ts'

/** Host-owned execution limits and reviewer defaults; never read from model arguments. */
export interface Config {
  /** Native verification CLI, resolved before a run. */
  intellect: string
  /** Native accountable action gateway. */
  action: string
  /** Compatible canonical specification CLI. */
  spec: string
  /** Private persistent plans and results, outside captured repositories. */
  stateRoot: string
  /** Default provider for both reviewer settings targets. */
  reviewerProvider: string
  /** Default model for both reviewer settings targets. */
  reviewerModel: string
  /** Maximum output tokens per reviewer request, including corrections. */
  maxTokens: number
  /** Maximum seconds for a single reviewer stage. */
  reviewerTimeoutSeconds: number
  /** Maximum seconds for the complete native run. */
  runTimeoutSeconds: number
  /** Maximum bytes in a native model context packet. */
  maxContextBytes: number
}
export const Config: z<Config> = z.object({
  intellect: z.string().default('forge-intellect'), action: z.string().default('forge-intellect-action-mcp'), spec: z.string().default('spec'),
  stateRoot: z.string().default(dshHomePath('verification')),
  reviewerProvider: z.string().default('openrouter'), reviewerModel: z.string().default('deepseek/deepseek-v4-flash'),
  maxTokens: z.natural().min(1).default(20000), reviewerTimeoutSeconds: z.natural().min(1).default(420),
  runTimeoutSeconds: z.natural().min(1).default(3600), maxContextBytes: z.natural().min(1024).max(1500000).default(1500000),
})

const assessor = agentModelTargetId('deadal-intellect-assessor')
const challenger = agentModelTargetId('deadal-intellect-challenger')
const json = (text: string) => value.json().parse(JSON.parse(text))
const object = (input: unknown) => value.record(value.string(), value.unknown()).parse(input)
const id = (input: string) => value.uuid().parse(input)

/** Remove ambient variables except non-secret runtime paths from native children.
 * @returns Tombstones for excluded environment keys and allowed runtime paths.
 */
export function nativeEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set(['PATH', 'TMPDIR', 'CARGO_HOME', 'RUSTUP_HOME', 'SystemRoot', 'WINDIR'])
  return { ...Object.fromEntries(Object.entries(process.env).map(([key, entry]) => [key, allowed.has(key) ? entry : undefined])),
    CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), '.cargo'),
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'),
  }
}

/** Reapply the branded effort after validating retained JSON. */
function modelSelection(input: Plan['reviewers']['assessor']): ModelSelection {
  return {
    provider: input.provider, model: input.model,
    ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(input.reasoningEffort) }) }
}

declare module '@deepseek-ai/cordis' { interface Context { forgeIntellect: ForgeIntellect } }
declare module '@deepseek-ai/dsh-jobs' { interface JobKindMap { intellect: 'intellect' } }

/** Local native provider and application service; model-facing tools live in the scoped ./tool entry. */
export default class ForgeIntellect extends Service {
  static inject = ['subprocess', 'agents', 'agentModels', 'jobs', 'approval', 'credentials']
  static Config = Config
  private readonly selfCtx: Context
  private active = new Map<string, { controller: AbortController; done: Promise<JobOutcome> }>()

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'forgeIntellect')
    this.selfCtx = ctx
    for (const [target, label] of [[assessor, 'Deadal-intellect assessor'], [challenger, 'Deadal-intellect challenger']] as const) {
      ctx.effect(() => ctx.agentModels.registerTarget({
        id: target, label, defaultSelection: { provider: config.reviewerProvider, model: config.reviewerModel } }))
    }
    ctx.effect(() => async () => {
      for (const task of this.active.values()) task.controller.abort()
      await Promise.allSettled([...this.active.values()].map(task => task.done))
    })
  }

  /** Run a native command with bounded output and cancellation, then await its managed process range. */
  private async command(argv: string[], cwd: string, signal?: AbortSignal, timeoutSeconds = 120) {
    const timeout = AbortSignal.timeout(timeoutSeconds * 1000)
    const cancel = signal ? AbortSignal.any([signal, timeout]) : timeout
    const process = this.ctx.subprocess.spawn({ argv, cwd, env: nativeEnvironment(), signal: cancel, graceMs: 45000,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4 * 1024 * 1024 }, stderr: { maxBytes: 128 * 1024 } },
    })
    try {
      const outcome = await process.done
      const stdout = process.collected.stdout?.readFrom(0)
      const stderr = process.collected.stderr?.readFrom(0)
      if (!stdout || !stderr) throw new Error('Native command omitted its configured output streams')
      cancel.throwIfAborted()
      if (outcome.exitCode !== 0) throw new Error(`${argv[0]} failed (${outcome.exitCode ?? outcome.signal}): ${stderr.text.slice(-2000)}`)
      if (stdout.lossy) throw new Error('Native response exceeded its output bound')
      return stdout.text.trim()
    } finally {
      process.terminate()
      await process.waitForExit()
    }
  }

  private async executable(name: string, signal?: AbortSignal) {
    try { return await this.ctx.subprocess.resolveExecutable(name, undefined, signal) }
    catch { throw new Error(`Required executable ${name} is unavailable. Install the matching Forge Spec and Forge Intellect tools, then retry intellect_overview.`) }
  }

  private async repository(agent: Agent, signal?: AbortSignal) {
    const cwd = agent.session.header.cwd
    if (!cwd) throw new Error('Choose a repository workspace before using Intellect')
    const git = await this.executable('git', signal)
    const env = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null']
    let root: string
    try { root = await realpath(await this.command([git, ...env, '-C', cwd, 'rev-parse', '--show-toplevel'], cwd, signal)) }
    catch (error) {
      if (error instanceof Error && error.message.includes('not a git repository')) throw new Error('Choose or initialize a Git repository workspace before using Intellect.')
      throw error
    }
    const revision = await this.command([git, ...env, '-C', root, 'rev-parse', 'HEAD'], root, signal)
    const dirty = await this.command([git, ...env, '-C', root, 'status', '--porcelain', '--untracked-files=normal'], root, signal)
    return { root, revision, clean: dirty === '' }
  }

  private area(repository: string) {
    return join(this.config.stateRoot, createHash('sha256').update(repository).digest('hex').slice(0, 24))
  }
  private async save(path: string, input: unknown, exclusive = true) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const bytes = JSON.stringify(input, null, 2) + '\n'
    if (exclusive) await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
    else await writeFileAtomic(path, bytes, { mode: 0o600 })
  }
  private async plan(repository: string, planId: string): Promise<Plan> {
    const plan = readPlan(json(await readFile(join(this.area(repository), 'plans', id(planId), 'plan.json'), 'utf8')))
    if (plan.repository !== repository) throw new Error('Verification plan belongs to another repository')
    const policy = json(await readFile(join(this.area(repository), 'plans', plan.id, 'policy.json'), 'utf8'))
    if (JSON.stringify(policy) !== JSON.stringify(plan.policy)) throw new Error('Verification policy changed; prepare a new plan')
    return plan
  }
  private async record(repository: string, runId: string): Promise<RunRecord> {
    const record = runSchema.parse(json(await readFile(join(this.area(repository), 'records', id(runId) + '.json'), 'utf8')))
    if (record.repository !== repository) throw new Error('Verification run belongs to another repository')
    return record.state === 'running' && !this.active.has(record.id) ? { ...record, state: 'interrupted' as const } : record
  }

  /** Discover repository readiness without executing checks or reviews.
   * @param agent - conversation whose workspace is selected.
   * @param signal - cancellation of discovery.
   * @returns Repository, specifications, reviewer routes, diagnostics and retained runs.
   */
  async overview(agent: Agent, signal: AbortSignal): Promise<JsonValue> {
    const repo = await this.repository(agent, signal)
    const prerequisites: Record<string, string> = {}
    for (const [name, binary] of Object.entries({ spec: this.config.spec, intellect: this.config.intellect, action: this.config.action })) {
      try { prerequisites[name] = await this.executable(binary, signal) }
      catch (error) { prerequisites[name] = String(error) }
    }
    let specifications: unknown[] = []
    let diagnostic = ''
    try {
      const model = object(json(await this.command([await this.executable(this.config.spec, signal), 'inspect', 'model', '--json'], repo.root, signal)))
      const state = object(model.state)
      if (!state.valid) diagnostic = 'Specification validation failed; fix spec lint diagnostics before verifying.'
      specifications = value.array(value.unknown()).parse(state.specifications)
        .filter(s => /^(REQ|INV|IFC|SCN):/.test(String(object(s).id))).map((s) => {
          const spec = object(s)
          return { id: spec.id, summary: spec.summary, path: spec.path, status: spec.status }
        })
    } catch (error) { diagnostic = String(error) }
    const records = await readdir(join(this.area(repo.root), 'records')).catch((error: unknown) => { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []; throw error })
    const runs = []
    for (const file of records.filter(name => name.endsWith('.json'))) runs.push(await this.record(repo.root, file.slice(0, -5)))
    runs.sort((a, b) => b.createdAt - a.createdAt)
    return json(JSON.stringify({
      repository: repo.root, revision: repo.revision, clean: repo.clean, prerequisites, diagnostic, specifications, runs: runs.slice(0, 30),
      reviewers: {
        assessor: this.ctx.agentModels.currentSelection(assessor),
        challenger: this.ctx.agentModels.currentSelection(challenger),
      },
      openrouterCredential: await this.ctx.credentials.describe(credentialRef('OPENROUTER_API_KEY')),
      next: !repo.clean ? 'Finish and commit intended changes before preparing a verification plan.' : 'Select durable subjects and prepare a concrete check plan.',
    }))
  }

  /** Prepare an immutable plan without running checks or review models; dirty repositories reject.
   * @param agent - conversation whose workspace is selected.
   * @param input - proposed subjects, source paths and fixed checks.
   * @param signal - cancellation of preparation.
   * @returns Validated plan retained with its native policy.
   */
  async prepare(agent: Agent, input: PlanInput, signal: AbortSignal): Promise<Plan> {
    const selected = planInputSchema.parse(input)
    const repo = await this.repository(agent, signal)
    if (!repo.clean) throw new Error('The repository has uncommitted changes. Finish and commit the intended changes before preparing verification.')
    const planId = randomUUID()
    const environment: Record<string, string> = { PATH: '${ENV:PATH}', TMPDIR: '${RUN}/scratch', PYTHONDONTWRITEBYTECODE: '1' }
    for (const key of ['CARGO_HOME', 'RUSTUP_HOME']) if (process.env[key]) environment[key] = '${ENV:' + key + '}'
    if (selected.checks.some(c => c.argv[0]?.endsWith('cargo'))) {
      environment.CARGO_HOME = '${ENV:CARGO_HOME}'
      environment.RUSTUP_HOME = '${ENV:RUSTUP_HOME}'
      environment.PATH = '${ENV:CARGO_HOME}/bin:${ENV:PATH}'
      environment.CARGO_TARGET_DIR = '${RUN}/target'
    }
    const body: Omit<Plan, 'digest'> = {
      schema: 'deadal-intellect-plan/v1', id: planId, repository: repo.root, revision: repo.revision,
      policy: { schema: 'forge-intellect-verification-policy/v1', id: 'deadal-intellect-' + planId, ...selected,
        checks: selected.checks.map(check => ({ ...check, required: true })), command_environment: environment, command_wrapper: [],
        generated_test_prefixes: [], max_probes: 0, max_context_bytes: this.config.maxContextBytes,
        agent_timeout_seconds: this.config.reviewerTimeoutSeconds, run_timeout_seconds: this.config.runTimeoutSeconds },
      reviewers: {
        assessor: this.ctx.agentModels.currentSelection(assessor),
        challenger: this.ctx.agentModels.currentSelection(challenger),
      }, maxTokens: this.config.maxTokens,
    }
    const plan = { ...body, digest: planDigest(body) }
    const path = join(this.area(repo.root), 'plans', planId)
    await this.save(join(path, 'policy.json'), plan.policy)
    await this.command([await this.executable(this.config.intellect, signal), 'verify', 'check-policy', join(path, 'policy.json')], repo.root, signal)
    const spec = await this.executable(this.config.spec, signal)
    const model = object(json(await this.command([spec, 'inspect', 'model', '--json'], repo.root, signal)))
    const state = object(model.state)
    if (!state.valid) throw new Error('Specifications are invalid; run spec lint and repair them before verification')
    const owners = new Set(value.array(value.unknown()).parse(state.specifications).map(s => String(object(s).id)))
    for (const subject of selected.subjects) if (!owners.has(subject.replace(/#.*/, ''))) throw new Error(`Unknown durable subject ${subject}`)
    await this.save(join(path, 'plan.json'), plan)
    return plan
  }

  private async authorize(agent: Agent, plan: Plan, signal: AbortSignal, callId?: ToolCallId, source?: string) {
    const reason = `${source ? 'Reassess retained evidence from ' + source : 'Verify implementation'} at ${plan.repository} revision ${plan.revision}.\nSubjects: ${plan.policy.subjects.join(', ')}.\n${source ? 'Reuse authenticated checks; obtain fresh reviews.' : 'Run these approved commands in a disposable checkout on this computer:'}\n${plan.policy.checks.map(c => JSON.stringify(c.argv) + '\nRequired success markers: ' + JSON.stringify(c.success_markers)).join('\n')}\nSource selection: ${plan.policy.source_paths.join(', ')}; reviewers may request more captured repository source.\nSend relevant source, specifications and check output to ${plan.reviewers.assessor.provider}/${plan.reviewers.assessor.model} and ${plan.reviewers.challenger.provider}/${plan.reviewers.challenger.model}. Up to 12 reviewer requests, excluding provider transport retries; ${plan.maxTokens} output tokens each; total timeout ${plan.policy.run_timeout_seconds}s. API keys stay in Harness. No generated commands or mutations.\nPlan digest: ${plan.digest}`
    const outcome = await this.ctx.approval.request({ agent, toolName: source ? 'intellect_reassess' : 'intellect_run', ...(callId ? { callId } : {}), signal, reason })
    if (outcome !== 'allowed-once') throw new Error(`Verification plan approval ${outcome}; no job started`)
  }

  /** Request approval and start a native verification job; altered plans and stale candidates reject.
   * @param agent - conversation that owns approval and job collection.
   * @param planId - retained execution plan.
   * @param signal - cancellation through approval and launch; the job owns later cancellation.
   * @param callId - originating tool call for the approval audit.
   * @param source - original retained run when reassessing authenticated execution.
   * @returns Retained run, job and effective plan identifiers after successful launch.
   */
  async start(
    agent: Agent, planId: string, signal: AbortSignal, callId?: ToolCallId, source?: string,
  ): Promise<{ runId: string; jobId: JobId; planId: string }> {
    if (process.platform === 'win32') throw new Error('Native Intellect verification currently requires macOS or Linux')
    const repo = await this.repository(agent, signal)
    let plan = await this.plan(repo.root, planId)
    if (!repo.clean || repo.revision !== plan.revision) throw new Error('Verification plan is stale. Prepare a new plan for the clean current revision.')
    if (this.active.size) throw new Error('A verification job is already running. Collect or cancel it before starting another.')
    const binaries = {
      intellect: await this.executable(this.config.intellect, signal),
      action: await this.executable(this.config.action, signal),
      spec: await this.executable(this.config.spec, signal) }
    if (source) {
      const record = await this.record(repo.root, source)
      if (record.plan !== planId) throw new Error('Reassessment must use the original execution plan')
      const status = object(await this.result(agent, source, signal))
      const native = object(status.verification)
      if (native.execution_freshness !== 'current') throw new Error('Retained execution is stale or unavailable. Start a fresh run.')
      const next = { ...plan, id: randomUUID(), reviewers: {
        assessor: this.ctx.agentModels.currentSelection(assessor),
        challenger: this.ctx.agentModels.currentSelection(challenger),
      }, maxTokens: this.config.maxTokens }
      plan = { ...next, digest: planDigest(next) }
      planId = plan.id
      await this.save(join(this.area(repo.root), 'plans', plan.id, 'policy.json'), plan.policy)
      await this.save(join(this.area(repo.root), 'plans', plan.id, 'plan.json'), plan)

    }
    await this.authorize(agent, plan, signal, callId, source)
    signal.throwIfAborted()
    const current = await this.repository(agent, signal)
    const reloaded = await this.plan(repo.root, planId)
    if (!current.clean || current.revision !== plan.revision || reloaded.digest !== plan.digest) throw new Error('Repository or plan changed during approval; prepare a new plan')
    if (this.active.size) throw new Error('Another verification job started during approval')
    const runId = randomUUID()
    const record: RunRecord = { schema: 'deadal-intellect-run/v1', id: runId, plan: plan.id, repository: repo.root, createdAt: Date.now(), state: 'running', ...(source ? { source } : {}) }
    const recordPath = join(this.area(repo.root), 'records', runId + '.json')
    const controller = new AbortController()
    const progress: string[] = ['Preparing an isolated checkout and evidence capture.']
    const completion = Promise.withResolvers<JobOutcome>()
    this.active.set(runId, { controller, done: completion.promise })
    const settle = (outcome: JobOutcome) => {
      this.active.delete(runId)
      if (outcome.output) progress.push(outcome.output)
      completion.resolve(outcome)
      return outcome
    }
    try {
      await this.save(recordPath, record)
      signal.throwIfAborted()
      controller.signal.throwIfAborted()
      const job = this.ctx.jobs.start({ kind: 'intellect', label: `Verify ${plan.policy.subjects.join(', ')}`, owner: agent, outputLimitBytes: 32000,
        run: () => {
          const done = this.execute(plan, record, binaries, controller.signal, message => progress.push(message)).then(async () => {
            await this.save(recordPath, { ...record, state: 'completed' }, false)
            return { status: 'completed', output: `Verification retained as ${runId}. Use intellect_result to inspect native decisions and freshness.` } satisfies JobOutcome
          }, async (error: unknown) => {
            const message = error instanceof Error ? error.message : 'Verification failed'
            await this.save(recordPath, { ...record, state: controller.signal.aborted ? 'cancelled' : 'failed', error: message }, false)
            return { status: controller.signal.aborted ? 'killed' : 'failed', output: `Verification ${runId}: ${message}. Partial native evidence is retained; intellect_result reports what is available.` } satisfies JobOutcome
          }).then(settle, (error: unknown) => settle({ status: 'failed', output: `Verification result could not be recorded: ${String(error)}` }))
          return { cancel: () =>{  controller.abort() }, done, readOutput: () => progress.splice(0).join('\n') }
        },
      })
      return { runId, jobId: job, planId: plan.id }
    } catch (error) {
      controller.abort()
      settle({ status: 'failed' })
      await this.save(recordPath, { ...record, state: 'failed', error: String(error) }, false)
      throw error
    }
  }

  private async execute(
    plan: Plan, record: RunRecord, binaries: { intellect: string; spec: string; action: string },
    signal: AbortSignal, progress: (message: string) => void,
  ) {
    const run = join(this.area(plan.repository), 'runs', record.id)
    await mkdir(dirname(run), { recursive: true, mode: 0o700 })
    const bridge = await openBridge(run, signal, async (packet, directory, cancelled) => {
      progress(`${packet.role}: ${packet.stage === 'plan' ? 'planning checks' : 'reviewing captured evidence'}.`)
      const answer = await reviewPacket(
        this.selfCtx, packet, modelSelection(plan.reviewers[packet.role]), plan.maxTokens, directory,
        AbortSignal.any([cancelled, AbortSignal.timeout(plan.policy.agent_timeout_seconds * 1000)]),
      )
      progress(`${packet.role}: ${packet.stage} completed.`)
      return answer
    })
    try {
      const adapter = fileURLToPath(new URL('../runtime/bridge.mjs', import.meta.url))
      const policy = join(this.area(plan.repository), 'plans', plan.id, 'policy.json')
      const argv = [binaries.intellect, 'verify']
      if (record.source) argv.push('reassess', '--source', join(this.area(plan.repository), 'runs', record.source))
      else argv.push('run', '--repository', plan.repository, '--revision', plan.revision, '--spec', binaries.spec, '--action', binaries.action)
      argv.push('--policy', policy, '--output', run, '--agent-command-json', JSON.stringify([process.execPath, adapter, bridge.path]))
      await this.command(argv, plan.repository, signal, plan.policy.run_timeout_seconds + 60)
    } finally { await bridge.close() }
  }

  /** Revalidate retained evidence and distinguish execution state from assessment and freshness.
   * @param agent - conversation selecting the repository.
   * @param runId - retained run to inspect.
   * @param signal - cancellation of native inspection.
   * @param evidence - include authenticated detailed evidence when true.
   * @returns Native status, or an explicit unavailable diagnostic for incomplete evidence.
   */
  async result(agent: Agent, runId: string, signal: AbortSignal, evidence: boolean = false): Promise<JsonValue> {
    const repo = await this.repository(agent, signal)
    const record = await this.record(repo.root, runId)
    const plan = await this.plan(repo.root, record.plan)
    const run = join(this.area(repo.root), 'runs', record.id)
    const binary = await this.executable(this.config.intellect, signal)
    if (record.state === 'running' && this.active.has(runId)) return json(JSON.stringify({ run: record, verification: { freshness: 'unavailable', reason: 'Verification is running. Retained evidence is not yet sealed.' } }))
    let verification
    try { verification = json(await this.command([binary, 'verify', 'status', run, repo.root, join(this.area(repo.root), 'plans', plan.id, 'policy.json')], repo.root, signal)) }
    catch (error) { return json(JSON.stringify({ run: record, verification: { freshness: 'unavailable', reason: String(error) } })) }
    if (evidence) {
      const details = json(await this.command([binary, 'verify', 'evidence', run], repo.root, signal))
      return json(JSON.stringify({ run: record, verification, evidence: details }))
    }
    return json(JSON.stringify({ run: record, verification }))
  }

  /** Issue a native qualified attestation; failed eligibility rejects without a manual fallback.
   * @param agent - conversation selecting the repository.
   * @param runId - retained run whose evidence supports issuance.
   * @param signal - cancellation of native issuance.
   * @returns Native immutable attestation result after successful local issuance.
   */
  async attest(agent: Agent, runId: string, signal: AbortSignal): Promise<JsonValue> {
    const repo = await this.repository(agent, signal)
    const record = await this.record(repo.root, runId)
    const plan = await this.plan(repo.root, record.plan)
    return json(await this.command([await this.executable(this.config.intellect, signal), 'verify', 'attest', join(this.area(repo.root), 'runs', record.id), repo.root, join(this.area(repo.root), 'plans', plan.id, 'policy.json')], repo.root, signal))
  }
}
