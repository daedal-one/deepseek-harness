import { Context, Service } from '@deepseek-ai/cordis'
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, realpath } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { AgentModelConfig } from '@deepseek-ai/dsh-agent-default-model'
import { SessionId } from '@deepseek-ai/dsh-session'
import Subprocess from '@deepseek-ai/dsh-subprocess-local'
import Jobs from '@deepseek-ai/dsh-jobs-local'
import Approval from '@deepseek-ai/dsh-user-approval'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import Intellect, { Config } from '../src/index.ts'
import { planDigest, type PlanInput } from '../src/plan.ts'
import * as Tools from '../src/tool.ts'
import * as FixtureModel from './fixtures/model.ts'

class Credentials extends Service {
  constructor(ctx: Context) { super(ctx, 'credentials') }
  async describe() { return { configured: false } }
}

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
const signal = () => new AbortController().signal
const input: PlanInput = {
  subjects: ['REQ:fixture/check'], source_paths: ['value.txt'],
  checks: [{ id: 'value', argv: ['node', 'check.mjs'], obligations: ['REQ:fixture/check'], timeout_seconds: 10,
    success_markers: ['assertions passed'], failure_markers: ['assertion failed'] }],
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'intellect-service-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'repository'))
  const repository = await realpath(join(root, 'repository'))
  await writeFile(join(repository, 'value.txt'), 'committed\n')
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-C', repository, ...args], { encoding: 'utf8', stdio: 'pipe' })
  git('init', '-b', 'main')
  git('add', 'value.txt')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture')
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentModelConfig, { provider: 'fixture', model: 'reviewer' })
  const loop = await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(Subprocess)
  await ctx.plugin(Jobs)
  ctx.jobs.attachController('fixture')
  await ctx.plugin(Approval, { policy: 'ask' })
  await ctx.plugin(Credentials)
  await ctx.plugin(FixtureModel)
  const agent = await loop.create(SessionId('owner'), { provider: 'fixture', model: 'reviewer' }, { cwd: repository })
  agent.session.append('turn/start', { turn: 1 })
  const stateRoot = join(root, 'verification')
  const fiber = await ctx.plugin(Intellect, Config({ stateRoot, spec: 'fixture-spec', intellect: 'fixture-intellect', action: 'fixture-action', reviewerProvider: 'intellect-fixture', reviewerModel: 'reviewer' }))
  await ctx.plugin(Tools)
  const service = ctx.forgeIntellect
  const native = {
    valid: true, status: 'current', error: '', hold: false, review: false, reviewStage: 'plan', missing: '', overflow: false, omitCapture: false, signalExit: false, throwRun: false,
    calls: [] as string[][],
  }
  const resolve = ctx.subprocess.resolveExecutable.bind(ctx.subprocess)
  vi.spyOn(ctx.subprocess, 'resolveExecutable').mockImplementation((name, ...args) => name === native.missing ? Promise.reject(new Error('not installed')) : name.startsWith('fixture-') ? Promise.resolve(name) : resolve(name, ...args))
  const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
  vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((request) => {
    if (!request.argv[0]?.startsWith('fixture-')) return spawn(request)
    const args = [...request.argv]
    native.calls.push(args)
    if (native.omitCapture) {
      const handle = spawn({ ...request, argv: [process.execPath, '-e', ''] })
      return { ...handle, collected: {} }
    }
    if (native.signalExit) return spawn({ ...request, argv: [process.execPath, '-e', 'process.kill(process.pid,"SIGTERM")'] })
    if (native.throwRun && args[2] === 'run') throw 'native provider disconnected'

    if (native.overflow && args[0] === 'fixture-spec') return spawn({ ...request, argv: [process.execPath, '-e', 'process.stdout.write("x".repeat(5*1024*1024))'] })
    let response: unknown = { accepted: true }
    if (args[0] === 'fixture-spec') response = { state: { valid: native.valid, specifications: [
      { id: 'REQ:fixture/check', summary: 'fixture', path: 'check.spec.md', status: 'accepted' },
      { id: 'TASK:fixture/check' },
    ] } }
    if (args[2] === 'status') response = { execution_freshness: native.status, freshness: native.status }
    // Only the external native CLI is substituted; process cancellation, jobs, plans and approval stay real.
    const reviewCode = `
      const {mkdirSync,writeFileSync}=require('node:fs');
      const {join}=require('node:path');
      const {execFileSync}=require('node:child_process');
      const args=JSON.parse(process.argv[1]);
      const run=args[args.indexOf('--output')+1];
      const command=JSON.parse(args[args.indexOf('--agent-command-json')+1]);
      const directory=join(run,'agents','assessor','plan');
      mkdirSync(directory,{recursive:true});
      const properties={schema:{type:'string'},role:{type:'string'},selected_checks:{type:'array',items:{type:'string'}},additional_reads:{type:'array',items:{type:'string'}},probes:{type:'array',items:{type:'string'}},concerns:{type:'array',items:{type:'string'}}};
      const packet={schema:'forge-intellect-verification-agent/v1',role:'assessor',stage:'plan',context:{obligations:[],sources:{}},checks:[],repository_files:[],response_contract:{type:'object',properties,required:Object.keys(properties)}};
      if (process.argv[2]==='review') {
        packet.stage='review'; packet.results=[];
        packet.response_contract.properties={schema:{type:'string'},role:{type:'string'},reviews:{type:'array',items:{type:'object',required:[],properties:{citations:{type:'array',items:{}},limitations:{type:'array',items:{type:'string'}}}}},blocking_findings:{type:'array',items:{type:'string'}}};
        packet.response_contract.required=Object.keys(packet.response_contract.properties);
      }
      const selectedDirectory=join(run,'agents','assessor',packet.stage);
      mkdirSync(selectedDirectory,{recursive:true});
      writeFileSync(join(selectedDirectory,'request.json'),JSON.stringify(packet));
      try { execFileSync(command[0],command.slice(1),{cwd:selectedDirectory,input:JSON.stringify(packet),encoding:'utf8'}); } catch(error) { process.stderr.write(String(error.stderr)); process.exit(1); }
      process.stdout.write('{}');
    `
    if (native.review && args[2] === 'run') return spawn({ ...request, argv: [process.execPath, '-e', reviewCode, JSON.stringify(args), native.reviewStage] })
    const code = native.hold && args[2] === 'run' ? 'setInterval(() => {}, 1000)' : native.error
      ? 'process.stderr.write(process.argv[1]); process.exitCode = 1'
      : 'process.stdout.write(process.argv[1])'
    return spawn({ ...request, argv: [process.execPath, '-e', code, native.error || JSON.stringify(response)] })
  })
  ctx.on('approval/request', async () => 'allowed-once')
  const area = join(stateRoot, createHash('sha256').update(repository).digest('hex').slice(0, 24))
  const record = async (id: string) => JSON.parse(await readFile(join(area, 'records', id + '.json'), 'utf8')) as Record<string, unknown>
  const call = (name: string, args: object, owned = true) => ctx.tools.execute({
    name, arguments: args, signal: signal(), callId: ToolCallId('fixture-call'), ...(owned ? { agent } : {}),
  })
  return { ctx, agent, service, native, repository, root, area, git, fiber, record, call, loop }
}

describe.skipIf(process.platform === 'win32')('verification executor and retained state', () => {
  it('requires an owning conversation and exposes readiness without starting a native run', async () => {
    const f = await fixture()
    expect(await f.call('intellect_overview', {}, false)).toMatchObject({ isError: true })
    expect(await f.call('intellect_overview', {})).not.toMatchObject({ isError: true })
    for (const name of ['intellect_overview', 'intellect_prepare', 'intellect_run', 'intellect_result', 'intellect_reassess', 'intellect_attest']) {
      expect(f.ctx.tools.get(name)?.presentCall?.(name === 'intellect_prepare' ? input : name === 'intellect_overview' ? {} : { runId: 'run', planId: 'plan' })).toMatchObject({ card: 'generic' })
    }
    const overview = await f.service.overview(f.agent, signal())
    expect(overview).toMatchObject({ clean: true, runs: [], specifications: [{ id: 'REQ:fixture/check' }] })
    expect(f.native.calls.every(args => args[2] !== 'run')).toBe(true)
  })

  it('retains completed evidence, reassesses without overwriting the source, and dispatches attestation', async () => {
    const f = await fixture()
    f.native.review = true
    const plan = await f.service.prepare(f.agent, input, signal())
    expect(await f.call('intellect_prepare', input)).not.toMatchObject({ isError: true })
    const dispatched = await f.call('intellect_run', { planId: plan.id })
    expect(dispatched.isError).not.toBe(true)
    const started = JSON.parse(dispatched.content.filter(block => block.type === 'text').map(block => block.text).join('')) as Awaited<ReturnType<typeof f.service.start>>
    expect(await f.ctx.jobs.wait(started.jobId, 10000, f.agent), JSON.stringify(await f.record(started.runId))).toMatchObject({ status: 'completed' })
    expect(await f.record(started.runId)).toMatchObject({ state: 'completed', plan: plan.id })
    expect(await f.service.result(f.agent, started.runId, signal())).toMatchObject({ verification: { freshness: 'current' } })
    expect(await f.call('intellect_result', { runId: started.runId, evidence: true })).not.toMatchObject({ isError: true })
    expect(await f.call('intellect_result', { runId: started.runId })).not.toMatchObject({ isError: true })
    expect(await f.call('intellect_attest', { runId: started.runId })).not.toMatchObject({ isError: true })
    const reassessment = await f.call('intellect_reassess', { planId: plan.id, runId: started.runId })
    expect(reassessment.isError).not.toBe(true)
    const repeated = JSON.parse(reassessment.content.filter(block => block.type === 'text').map(block => block.text).join('')) as Awaited<ReturnType<typeof f.service.start>>
    await f.ctx.jobs.wait(repeated.jobId, 10000, f.agent)
    expect(repeated.planId).not.toBe(plan.id)
    expect(await f.record(repeated.runId)).toMatchObject({ source: started.runId, state: 'completed' })
    expect(await f.record(started.runId)).toMatchObject({ state: 'completed', plan: plan.id })
    expect(await f.service.overview(f.agent, signal())).toMatchObject({ runs: [{ id: repeated.runId }, { id: started.runId }] })
    f.native.status = 'stale'
    await expect(f.service.start(f.agent, plan.id, signal(), undefined, started.runId)).rejects.toThrow('stale or unavailable')
    await expect(f.service.start(f.agent, repeated.planId, signal(), undefined, started.runId)).rejects.toThrow('original execution plan')
    f.native.error = 'evidence unavailable'
    expect(await f.service.result(f.agent, started.runId, signal())).toMatchObject({ verification: { freshness: 'unavailable' } })
  })

  it('refuses dirty repositories, unknown subjects, altered plans and stale revisions', async () => {
    const f = await fixture()
    await expect(f.service.prepare(f.agent, { ...input, subjects: ['REQ:missing'] }, signal())).rejects.toThrow('Unknown durable subject')
    f.native.valid = false
    await expect(f.service.prepare(f.agent, input, signal())).rejects.toThrow('Specifications are invalid')
    expect(await f.service.overview(f.agent, signal())).toMatchObject({ diagnostic: expect.stringContaining('validation failed') as string })
    f.native.valid = true
    const plan = await f.service.prepare(f.agent, input, signal())
    const planFile = join(f.area, 'plans', plan.id, 'plan.json')
    await writeFile(planFile, JSON.stringify({ ...plan, repository: '/foreign', digest: planDigest({ ...plan, repository: '/foreign' }) }))
    await expect(f.service.start(f.agent, plan.id, signal())).rejects.toThrow('another repository')
    await writeFile(planFile, JSON.stringify(plan))
    const policyFile = join(f.area, 'plans', plan.id, 'policy.json')
    await writeFile(policyFile, '{}')
    await expect(f.service.start(f.agent, plan.id, signal())).rejects.toThrow('policy changed')
    await writeFile(policyFile, JSON.stringify(plan.policy))
    await writeFile(join(f.repository, 'value.txt'), 'dirty\n')
    await expect(f.service.prepare(f.agent, input, signal())).rejects.toThrow('uncommitted changes')
    expect(await f.service.overview(f.agent, signal())).toMatchObject({ next: expect.stringContaining('Finish and commit') as string })
    await expect(f.service.start(f.agent, plan.id, signal())).rejects.toThrow('stale')
    expect(f.native.calls.some(args => args[2] === 'run')).toBe(false)
  })

  it('rechecks approval-time edits before reserving a run', async () => {
    const f = await fixture()
    const plan = await f.service.prepare(f.agent, input, signal())
    f.ctx.on('approval/request', async () => {
      await writeFile(join(f.repository, 'value.txt'), 'changed during approval')
      return 'allowed-once'
    }, { prepend: true })
    await expect(f.service.start(f.agent, plan.id, signal())).rejects.toThrow('changed during approval')
    expect(f.native.calls.some(args => args[2] === 'run')).toBe(false)
  })

  it('cancels and awaits jobs during disposal without recording success', async () => {
    const f = await fixture()
    const plan = await f.service.prepare(f.agent, input, signal())
    f.native.hold = true
    const started = await f.service.start(f.agent, plan.id, signal())
    await vi.waitFor(() => { expect(f.native.calls.some(args => args[2] === 'run')).toBe(true) })
    expect(await f.service.result(f.agent, started.runId, signal())).toMatchObject({ verification: { freshness: 'unavailable', reason: expect.stringContaining('running') as string } })
    await expect(f.service.start(f.agent, plan.id, signal())).rejects.toThrow('already running')
    await f.fiber.dispose()
    expect(await f.record(started.runId)).toMatchObject({ state: 'cancelled' })
  })

  it('retains native failures and reports interrupted records after reload', async () => {
    const f = await fixture()
    const plan = await f.service.prepare(f.agent, input, signal())
    f.native.error = 'native refusal'
    const started = await f.service.start(f.agent, plan.id, signal())
    expect(await f.ctx.jobs.wait(started.jobId, 10000, f.agent)).toMatchObject({ status: 'failed' })
    expect(await f.record(started.runId)).toMatchObject({ state: 'failed', error: expect.stringContaining('native refusal') as string })
    const path = join(f.area, 'records', started.runId + '.json')
    await writeFile(path, JSON.stringify({ ...await f.record(started.runId), state: 'running' }))
    expect(await f.service.overview(f.agent, signal())).toMatchObject({ runs: [{ state: 'interrupted' }] })
    await writeFile(path, JSON.stringify({ ...await f.record(started.runId), repository: '/foreign' }))
    await expect(f.service.result(f.agent, started.runId, signal())).rejects.toThrow('another repository')
    expect((await readdir(join(f.area, 'records'))).length).toBe(1)
  })
  it('cannot launch a job when the integration is disposed during approval', async () => {
    const f = await fixture()
    const plan = await f.service.prepare(f.agent, input, signal())
    const entered = Promise.withResolvers<undefined>()
    const answer = Promise.withResolvers<'allowed-once'>()
    f.ctx.on('approval/request', async () => { entered.resolve(undefined); return answer.promise }, { prepend: true })
    const started = f.service.start(f.agent, plan.id, signal())
    const outcome = started.then(value => ({ value }), (error: unknown) => ({ error }))
    await entered.promise
    await f.fiber.dispose()
    answer.resolve('allowed-once')
    expect(await outcome).toHaveProperty('error')
    expect(f.native.calls.some(args => args[2] === 'run')).toBe(false)
  })

  it('reports absent native tools and refuses oversized native output', async () => {
    const f = await fixture()
    f.native.missing = 'fixture-spec'
    expect(await f.service.overview(f.agent, signal())).toMatchObject({ diagnostic: expect.stringContaining('unavailable') as string })
    await expect(f.service.prepare(f.agent, input, signal())).rejects.toThrow('unavailable')
    f.native.missing = ''
    f.native.overflow = true
    await expect(f.service.prepare(f.agent, input, signal())).rejects.toThrow('output bound')
  })

  it('requires a repository workspace and preserves unexpected Git failures', async () => {
    const f = await fixture()
    const unlocated = await f.loop.create(SessionId('unlocated'))
    await expect(f.service.overview(unlocated, signal())).rejects.toThrow('workspace')
    const outside = await f.loop.create(SessionId('outside'), {}, { cwd: f.root })
    await expect(f.service.overview(outside, signal())).rejects.toThrow('Git repository')
    const absent = await f.loop.create(SessionId('absent'), {}, { cwd: join(f.root, 'absent') })
    await expect(f.service.overview(absent, signal())).rejects.toThrow()
    await mkdir(f.area, { recursive: true })
    await writeFile(join(f.area, 'records'), 'not a directory')
    await expect(f.service.overview(f.agent, signal())).rejects.toMatchObject({ code: 'ENOTDIR' })
  })

  it('prepares Cargo checks with isolated build output and explicit runtime homes', async () => {
    const f = await fixture()
    vi.stubEnv('CARGO_HOME', undefined)
    vi.stubEnv('RUSTUP_HOME', undefined)
    const plan = await f.service.prepare(f.agent, { ...input, checks: [{ ...input.checks[0]!, argv: ['cargo', 'test'] }] }, signal())
    expect(plan.policy.command_environment).toMatchObject({ CARGO_TARGET_DIR: '${RUN}/target', CARGO_HOME: '${ENV:CARGO_HOME}', RUSTUP_HOME: '${ENV:RUSTUP_HOME}' })
  })

  it('retains a failed launch record when the job controller refuses admission', async () => {
    const f = await fixture()
    const plan = await f.service.prepare(f.agent, input, signal())
    vi.spyOn(f.ctx.jobs, 'start').mockImplementationOnce(() => { throw new Error('controller unavailable') })
    await expect(f.service.start(f.agent, plan.id, signal())).rejects.toThrow('controller unavailable')
    expect(await f.service.overview(f.agent, signal())).toMatchObject({ runs: [{ state: 'failed', error: expect.stringContaining('controller unavailable') as string }] })
  })

  it('exposes job progress and supports explicit job cancellation', async () => {
    const f = await fixture()
    const plan = await f.service.prepare(f.agent, input, signal())
    f.native.hold = true
    const started = await f.service.start(f.agent, plan.id, signal())
    await vi.waitFor(() => { expect(f.native.calls.some(args => args[2] === 'run')).toBe(true) })
    expect(f.ctx.jobs.read(started.jobId, f.agent).text).toContain('Preparing an isolated checkout')
    expect(f.ctx.jobs.kill(started.jobId, f.agent)).toBe('requested')
    await f.ctx.jobs.wait(started.jobId, 10000, f.agent)
    expect(await f.record(started.runId)).toMatchObject({ state: 'cancelled' })
  })

  it('rejects a second approved launch while the first job is active', async () => {
    const f = await fixture()
    const plan = await f.service.prepare(f.agent, input, signal())
    const both = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<'allowed-once'>()
    let approvals = 0
    f.ctx.on('approval/request', async () => { if (++approvals === 2) both.resolve(undefined); return release.promise }, { prepend: true })
    f.native.hold = true
    const first = f.service.start(f.agent, plan.id, signal())
    const second = f.service.start(f.agent, plan.id, signal())
    const settled = Promise.allSettled([first, second])
    await both.promise
    release.resolve('allowed-once')
    const outcomes = await settled
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find(outcome => outcome.status === 'rejected')
    expect(String(rejected?.reason)).toContain('during approval')
  })

  it('reports a durable-record failure without leaving an active job', async () => {
    const f = await fixture()
    const plan = await f.service.prepare(f.agent, input, signal())
    f.native.hold = true
    const started = await f.service.start(f.agent, plan.id, signal())
    await vi.waitFor(() => { expect(f.native.calls.some(args => args[2] === 'run')).toBe(true) })
    await rm(join(f.area, 'records'), { recursive: true })
    await writeFile(join(f.area, 'records'), 'storage failure')
    f.ctx.jobs.kill(started.jobId, f.agent)
    expect(await f.ctx.jobs.wait(started.jobId, 10000, f.agent)).toMatchObject({ status: 'failed' })
    expect(f.ctx.jobs.read(started.jobId, f.agent).text).toContain('could not be recorded')
    await f.fiber.dispose()
  })

  it('preserves approved reasoning selection through captured-evidence review', async () => {
    const f = await fixture()
    const plan = await f.service.prepare(f.agent, input, signal())
    plan.reviewers.assessor.reasoningEffort = 'high'
    plan.digest = planDigest(plan)
    await writeFile(join(f.area, 'plans', plan.id, 'plan.json'), JSON.stringify(plan))
    f.native.review = true
    f.native.reviewStage = 'review'
    const started = await f.service.start(f.agent, plan.id, signal())
    const finished = await f.ctx.jobs.wait(started.jobId, 10000, f.agent)
    const events = await readFile(join(f.area, 'runs', started.runId, 'agents/assessor/review/session-events.json'), 'utf8')
    expect(finished, events).toMatchObject({ status: 'completed' })
    expect(events).toContain('high')
  })

  it('rejects missing capture streams and native signal termination', async () => {
    const f = await fixture()
    f.native.omitCapture = true
    await expect(f.service.prepare(f.agent, input, signal())).rejects.toThrow('omitted its configured output streams')
    f.native.omitCapture = false
    f.native.signalExit = true
    await expect(f.service.prepare(f.agent, input, signal())).rejects.toThrow('SIGTERM')
  })

  it('settles a failed run even when an external provider throws a non-Error value', async () => {
    const f = await fixture()
    const plan = await f.service.prepare(f.agent, input, signal())
    f.native.throwRun = true
    const started = await f.service.start(f.agent, plan.id, signal())
    await f.ctx.jobs.wait(started.jobId, 10000, f.agent)
    expect(await f.record(started.runId)).toMatchObject({ state: 'failed', error: 'Verification failed' })
  })

  it('rejects unsupported Windows execution before creating native resources', async () => {
    const f = await fixture()
    let result: ReturnType<typeof f.service.start>
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    try { result = f.service.start(f.agent, 'unused', signal()) } finally { vi.unstubAllGlobals() }
    await expect(result).rejects.toThrow('requires macOS or Linux')
    expect(f.native.calls).toHaveLength(0)
  })

})
