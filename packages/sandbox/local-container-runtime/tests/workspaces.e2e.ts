import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import AgentPresets, { serviceForAgent } from '@deepseek-ai/dsh-agent-presets'
import * as HostFs from '@deepseek-ai/dsh-fs-local'
import * as HostSubprocess from '@deepseek-ai/dsh-subprocess-local'
import * as HostShell from '@deepseek-ai/dsh-bash-local'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import * as RepoAccess from '../src/tool-request-repo-access.ts'
import * as Instructions from '@deepseek-ai/dsh-agent-instructions'
import * as FsTools from '@deepseek-ai/dsh-tool-fs'
import ContainerFs from '@deepseek-ai/dsh-fs-local-container'
import ContainerSubprocess from '@deepseek-ai/dsh-subprocess-local-container'
import Runtime from '../src/index.ts'
import Workspaces from '../src/workspaces.ts'
import DevelopmentVms from '../src/vm.ts'
import { workspaceGit } from '../src/workspace-git.ts'
import { previewProbe, terminalProbe } from './vm/probes.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { describe, expect, it } from 'vitest'

const socketPath = process.env.DSH_PODMAN_SOCKET
const image = process.env.DSH_PODMAN_IMAGE
const rawPool = process.env.DSH_WORKSPACE_POOL
const rawVm = process.env.DSH_DEVELOPMENT_VM
const vmConfig: unknown = rawVm === undefined ? undefined : JSON.parse(rawVm)
const enabled = process.platform === 'linux' && socketPath !== undefined && image !== undefined && rawPool !== undefined
const limits = { gitCommand: '/usr/bin/git', authorName: 'DSH', authorEmail: 'dsh@localhost', resourceLimitCommand: '/usr/bin/prlimit', gitMemoryBytes: 512 * 1024 * 1024, maxBytes: 4 * 1024 * 1024, maxEntries: 1000, timeoutMs: 30_000 }

describe.skipIf(!enabled)('conversation workspace real Podman Loader flow', () => {
  it.each(process.env.DSH_PODMAN_EGRESS === '1' ? [false, true] : [false])('isolates conversations, returns repositories, and resumes with environment=%s', async (environment) => {
    if (socketPath === undefined || image === undefined || rawPool === undefined) throw new Error('workspace test environment disappeared')
    const poolPaths = JSON.parse(rawPool) as string[]
    const root = await mkdtemp(join(tmpdir(), 'dsh-workspaces-e2e-'))
    const source = join(root, 'source'); await mkdir(source)
    if (vmConfig !== undefined) await cp(new URL('./vm/app/', import.meta.url), join(source, 'app'), { recursive: true })
    await workspaceGit(source, ['init', '--template=', '--initial-branch=main'], limits)
    await writeFile(join(source, 'input.txt'), 'original\n'); await writeFile(join(source, '.gitignore'), 'ignored\n')
    await workspaceGit(source, ['add', '.'], limits); await workspaceGit(source, ['commit', '-m', 'initial'], limits)
    await writeFile(join(source, 'input.txt'), 'user edits\n'); await writeFile(join(source, 'untracked.txt'), 'user input\n'); await writeFile(join(source, 'ignored'), 'host secret\n')
    await writeFile(join(source, 'AGENTS.md'), 'WORKSPACE_IMPORTED_INSTRUCTIONS: Keep changes focused.\n')
    const secondSource = join(root, 'second-source')
    if (environment) await cp(source, secondSource, { recursive: true })
    const originalIndex = await readFile(join(source, '.git/index')); const originalHead = await workspaceGit(source, ['rev-parse', 'HEAD'], limits)
    const ids = [SessionId(`workspace-e2e-${randomUUID()}`), SessionId(`workspace-e2e-${randomUUID()}`)] as const
    const workspaceIds = new Set<string>()
    const ctx = new Context()
    let first: Awaited<ReturnType<typeof ctx.agents.create>> | undefined
    let second: Awaited<ReturnType<typeof ctx.agents.create>> | undefined
    let maintenance: Awaited<ReturnType<typeof ctx.agents.create>> | undefined
    const maintenanceId = SessionId(`maintenance-${randomUUID()}`)
    const presetRoot = join(root, 'presets'); const presetPath = join(presetRoot, 'maintenance')
    await mkdir(presetPath, { recursive: true })
    const hostFs = new URL('../../../fs/fs-local/src/index.ts', import.meta.url).href
    const hostSubprocess = new URL('../../../subprocess/subprocess-local/src/index.ts', import.meta.url).href
    const hostShell = new URL('../../../shell/bash-local/src/index.ts', import.meta.url).href
    await writeFile(join(presetPath, 'preset.yml'), 'name: Maintenance\ndescription: Explicit host probe.\n')
    await writeFile(join(presetPath, 'agent.cordis.yml'), JSON.stringify([{ name: 'cordis:group', group: true,
      isolate: { fs: true, subprocess: true, shell: true }, config: [
        { name: hostFs, config: { cwd: source } }, { name: hostSubprocess }, { name: hostShell },
      ] }]))
    const internalPresetPath = join(presetRoot, 'internal'); await mkdir(internalPresetPath)
    await writeFile(join(internalPresetPath, 'preset.yml'), 'name: Internal providers\ndescription: Instruction and reviewed transport services.\n')
    await writeFile(join(internalPresetPath, 'agent.cordis.yml'), JSON.stringify([
      { name: 'cordis:group', group: true, isolate: { fs: true }, config: [{ name: hostFs, config: { cwd: source } }] },
      { name: 'cordis:group', group: true, isolate: { subprocess: true }, config: [{ name: hostSubprocess }] },
    ]))
    if (vmConfig !== undefined) {
      const vmPresetPath = join(presetRoot, 'development-vm'); await mkdir(vmPresetPath)
      await writeFile(join(vmPresetPath, 'preset.yml'), 'name: Development VM\ndescription: Opt-in external integration fixture.\n')
      await writeFile(join(vmPresetPath, 'agent.cordis.yml'), JSON.stringify([
        { name: 'cordis:group', group: true, isolate: { developmentVms: true }, config: [{ name: 'development-vms', config: vmConfig }] },
      ]))
    }
    try {
      const modules = new Map<string, unknown>([
        [hostFs, HostFs], [hostSubprocess, HostSubprocess], [hostShell, HostShell], ['presets', AgentPresets],
        ['sessions', SessionStore], ['projections', SessionProjectionRegistry], ['persistence', Persistence], ['llm', LlmRuntime], ['agents', AgentRegistry],
        ['user-questions', UserQuestions], ['repo-access', RepoAccess], ['system-prompt', SystemPrompt], ['tools', Tools], ['loop', AgentLoop], ['container', Runtime], ['container-fs', ContainerFs], ['container-subprocess', ContainerSubprocess], ['workspaces', Workspaces], ['development-vms', DevelopmentVms], ['instructions', Instructions], ['fs-tools', FsTools],
      ])
      const entries = [
        { name: 'sessions' }, { name: 'projections' }, { name: 'persistence', config: { root: join(root, 'sessions'), compression: 'none' } },
        { name: 'user-questions' },
        { name: 'llm' }, { name: 'agents' }, { name: 'system-prompt' }, { name: 'tools' },
        { name: 'container', config: { network: environment ? 'outbound' : 'none', socketPath, manageService: false, serviceStartupTimeoutMs: 10000, image, user: 'dsh', environment: { HOME: '/home/dsh', LANG: 'C.UTF-8', PATH: '/usr/local/bin:/usr/bin:/bin' }, memoryBytes: 268435456, nanoCpus: 500000000, pidsLimit: 128, tmpfsBytes: 67108864, engineRequestTimeoutMs: 10000, maxLiveProcesses: 8, lifetimeMs: vmConfig === undefined ? 300000 : 900000, stopTimeoutSeconds: 2 } },
        { name: 'container-fs', config: { cwdAliases: [], maxFileBytes: 65536, diffBasisMaxBytes: 32768, maxControllerOutputBytes: 200000, operationTimeoutMs: 10000 } },
        { name: 'container-subprocess', config: { cwdAliases: [], controlOutputBytes: 4096, controlTimeoutMs: 10000 } },
        { name: 'presets', config: { default: 'maintenance', roots: [{ path: presetRoot, trust: 'user' }], includeShippedRoot: false, includeUserRoot: false } },
        { name: 'workspaces', config: { ...limits, hostSessions: [{ sessionId: maintenanceId, preset: 'maintenance', cwd: source }], ...(environment ? { environment: { id: 'e2e-environment', name: 'E2E environment', grantLifetimeMs: 3600000, repositories: [{ source, url: 'https://github.example/org/first.git', credentialTimeoutMs: 1000 }, { source: secondSource, url: 'https://github.example/org/second.git', credentialTimeoutMs: 1000 }], initialGrants: [{ repository: 'https://github.example/org/first.git', access: 'fetch' }] } } : {}), poolPaths, slotBytes: 67108864, slotInodes: 20000, recoveryRoot: join(root, 'recovery'), provenanceRoot: join(root, 'provenance'), maxOutputBytes: 8388608, settleTimeoutMs: 10000, retryDelayMs: 1000, messageProvider: 'mock-metadata', messageModel: 'cheap', messageInputBytes: 4096, messageOutputTokens: 64, messageTimeoutMs: 10000 } },
        { name: 'instructions', config: { dshHome: '/workspace/.dsh', maxBytes: 4096 } },
        ...(environment ? [{ name: 'repo-access' }] : []),
        { name: 'fs-tools' }, { name: 'loop', config: { agents: [] } },
      ]
      const configPath = join(root, 'cordis.yml'); await writeFile(configPath, JSON.stringify(entries))
      ctx.baseUrl = pathToFileURL(root).href + '/'; await ctx.plugin(Loader); ctx.loader.builtins.include = Include; ctx.loader.builtins.group = Group
      ctx.loader.internal = { version: 'v2', async import(specifier: string) { const module = modules.get(specifier); if (module === undefined) throw new Error(`unexpected test module ${specifier}`); return module } } as unknown as NonNullable<typeof ctx.loader.internal>
      await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } }); await ctx.loader.await()
      let approvals = 0
      ctx.on('user-questions/request', async ({ questions }) => { approvals++; return { answers: [{ id: questions[0]!.id, selected: ['Approve'] }] } })
      const adapter = new MockAdapter([...(environment ? [toolCallResponse('attach-repository', 'request_repo_access', { repository: 'https://github.example/org/second.git', access: 'fetch', reason: 'The user requested work across both repositories.' })] : []), toolCallResponse('workspace-write', 'write', { file_path: 'result.txt', content: 'agent result\n' }), textResponse('Done.'), textResponse('No further changes.'), textResponse('Background work remains active.'), 'hang'])
      ctx.llm.registerAdapter(['mock'], adapter)
      const names = textResponse(JSON.stringify({ HEAD: 'workspace-result', 'refs/heads/codex/conversation': 'workspace-result' }))
      ctx.llm.registerAdapter(['mock-metadata'], new MockAdapter([
        textResponse('feat: add result'), names, textResponse('chore: retain background output'),
      ]))
      maintenance = await ctx.agents.create({ sessionId: maintenanceId, meta: { cwd: source, agentPreset: 'maintenance' },
        agentOptions: { provider: 'mock', model: 'main' }, setup: async (scope) => { await ctx.agentPresets.mount(scope, 'maintenance') } })
      const hostFileSystem = serviceForAgent(ctx, maintenance.agent, 'fs')!
      const hostExecutor = serviceForAgent(ctx, maintenance.agent, 'shell')!
      expect(await hostFileSystem.readText(await hostFileSystem.resolve('ignored', { cwd: source }))).toBe('host secret\n')
      expect((await hostExecutor.run(hostExecutor.resolve({ command: 'cat ignored', workdir: source }))).stdout.text).toBe('host secret\n')
      expect(() => ctx.agents.withInitiator(maintenance!.agent, () => ctx.conversationWorkspaces.capture())).toThrow('host maintenance')
      const id = ids[0]
      const vmSetup = vmConfig === undefined ? undefined : async (scope: Context) => { await ctx.agentPresets.mount(scope, 'development-vm') }
      first = await ctx.agents.create({ sessionId: id, meta: { cwd: source, agentPreset: vmConfig === undefined ? 'internal' : 'development-vm' }, agentOptions: { provider: 'mock', model: 'main' },
        setup: vmSetup ?? (async (scope) => { await ctx.agentPresets.mount(scope, 'internal') }) })
      second = await ctx.agents.create({ sessionId: ids[1], meta: { cwd: source, ...vmConfig === undefined ? {} : { agentPreset: 'development-vm' } }, agentOptions: { provider: 'mock', model: 'main' },
        ...vmSetup === undefined ? {} : { setup: vmSetup } })
      const read = async (agent: Agent, path: string) => ctx.conversationWorkspaces.runForSession(
        agent.id, async () => ctx.fs.readText(await ctx.fs.resolve(path, { cwd: source })),
      )
      console.info('Workspace acceptance: imported source')
      expect(await read(first.agent, 'input.txt')).toBe('user edits\n')
      expect(await read(first.agent, 'untracked.txt')).toBe('user input\n')
      await expect(read(first.agent, 'ignored')).rejects.toThrow()
      const command = async (agent: Agent, code: string) => ctx.conversationWorkspaces.runForSession(agent.id, async () => {
        const process = ctx.subprocess.spawn({ argv: ['/bin/sh', '-c', code], cwd: source,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } }, graceMs: 1000 })
        const result = await process.done
        if (result.exitCode !== 0) throw new Error(process.collected.stderr?.readFrom(0).text ?? 'container command failed')
        return process.collected.stdout?.readFrom(0).text
      })
      if (vmConfig !== undefined) {
        expect(await command(first.agent, `test ! -e '${source}' && test ! -S /var/lib/incus/unix.socket && printf host-paths-absent`)).toBe('host-paths-absent')
        expect(await command(first.agent, 'cd app && { docker compose up -d --build --wait >/tmp/compose.log 2>&1 || { tail -30 /tmp/compose.log >&2; exit 1; }; } && cp browser.mjs /opt/dsh-browser/check.mjs && cd /opt/dsh-browser && node --version && wc -c check.mjs && node check.mjs')).toContain('vm-browser-ok')
        console.info('VM integration: Compose and Chromium ready')
        await ctx.conversationWorkspaces.runForSession(first.agent.id, async () => {
          const runtime = ctx.conversationWorkspaces.capture()
          await previewProbe(runtime)
          console.info('VM integration: authenticated HTTP and WebSocket preview passed')
          await terminalProbe(runtime)
        })
        console.info('VM integration: terminal passed')
        await command(second.agent, 'systemd-run --quiet --collect --unit=dsh-isolation python3 -m http.server 80 --bind 0.0.0.0 && curl --retry 10 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:80 >/dev/null')
        const peer = (await command(second.agent, 'hostname -I'))?.trim().split(' ')[0]
        if (peer === undefined || !/^\d+\.\d+\.\d+\.\d+$/u.test(peer)) throw new Error('missing guest IPv4 address')
        expect(await command(first.agent, `if curl --connect-timeout 2 --max-time 3 -fsS http://${peer}:80 >/dev/null 2>&1; then exit 1; fi; printf peer-denied`)).toBe('peer-denied')
        expect(await command(first.agent, `docker run --rm --privileged --pid=host -v /:/guest $(docker compose -f app/compose.yaml images -q app) sh -c 'test -f /guest/etc/os-release && test ! -e "/guest${source}" && test ! -S /guest/var/lib/incus/unix.socket && test ! -S "/guest${socketPath}" && printf guest-only'`)).toBe('guest-only')
      }
      console.info('Workspace acceptance: compiling and saving')
      expect(await command(first.agent, "printf 'int main(void) { return 0; }\\n' >probe.c && printf 'probe\\n' >>.gitignore && cc probe.c -o probe && ./probe && git add probe.c && git commit -m 'feat: add probe' && printf 'compiled-and-committed'"))
        .toContain('compiled-and-committed')
      expect(await command(first.agent, 'if dd if=/dev/zero of=quota-probe bs=1048576 count=80 >/dev/null 2>&1; then exit 2; fi; rm quota-probe; printf quota-enforced')).toBe('quota-enforced')
      await writeFile(join(source, 'input.txt'), 'concurrent host edit\n')
      first.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Write result.txt.' }], source: { kind: 'user' } }))
      await first.agent.whenIdle()
      const receipt = first.agent.session.snapshotEvents().findLast(event => event.type === 'workspace/state')
      expect(receipt?.data).toMatchObject({ phase: 'returned', turn: 1 })
      if (environment) {
        expect(approvals).toBe(1)
        expect(receipt?.data).toMatchObject({ environmentId: 'e2e-environment', repositories: [{ lastTurn: 1 }, { lastTurn: 1 }] })
        expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('revision\\\":2')
      }
      expect(JSON.stringify(adapter.requests[0]?.messages)).toContain('WORKSPACE_IMPORTED_INSTRUCTIONS')
      expect(JSON.stringify(adapter.requests[0]?.messages)).not.toContain(source)
      expect(await read(first.agent, 'result.txt')).toBe('agent result\n')
      if (vmConfig !== undefined) expect(await command(first.agent, 'curl -fsS http://127.0.0.1:8080')).toContain('id="counter">1</p>')
      await expect(read(second.agent, 'result.txt')).rejects.toThrow()
      expect(await readFile(join(source, '.git/index'))).toEqual(originalIndex)
      expect(await workspaceGit(source, ['rev-parse', 'HEAD'], limits)).toEqual(originalHead)
      expect(await readFile(join(source, 'input.txt'), 'utf8')).toBe('concurrent host edit\n')
      if (receipt?.type !== 'workspace/state') throw new Error('missing return receipt')
      workspaceIds.add(receipt.data.workspaceId)
      const secondReceipt = second.agent.session.snapshotEvents().findLast(event => event.type === 'workspace/state')
      if (secondReceipt?.type === 'workspace/state') workspaceIds.add(secondReceipt.data.workspaceId)
      for (const branch of Object.keys(receipt.data.branches)) expect((await workspaceGit(source, ['show', `${branch}:result.txt`], limits)).toString()).toBe('agent result\n')
      expect(first.agent.session.snapshotEvents().filter(event => event.type === 'workspace/commit-message-request')).toHaveLength(1)
      console.info('Workspace acceptance: Git return and running service passed')
      await first.dispose(); first = undefined
      if (vmConfig !== undefined) {
        for (const slot of poolPaths) {
          const owner = JSON.parse(await readFile(join(slot, 'owner.json'), 'utf8')) as { workspaceId: string }
          if (owner.workspaceId === receipt.data.workspaceId) {
            await rm(join(slot, 'workspace'), { recursive: true })
            await rm(join(slot, 'owner.json'))
          }
        }
      }
      console.info('Workspace acceptance: resuming after RAM loss')
      first = await ctx.agents.resume({ resumeSessionId: id, agentOptions: { provider: 'mock', model: 'main' },
        ...vmSetup === undefined ? {} : { setup: vmSetup } })
      expect(await read(first.agent, 'result.txt')).toBe('agent result\n')
      expect(await command(first.agent, 'git log -1 --format=%s HEAD^')).toBe('feat: add probe\n')
      // Docker's published port can reset connections before the restored application finishes startup.
      if (vmConfig !== undefined) expect(await command(first.agent, 'curl --retry 20 --retry-all-errors --retry-max-time 30 --max-time 5 --retry-delay 1 -fsS http://127.0.0.1:8080')).toContain('id="counter">1</p>')
      console.info('Workspace acceptance: recovery passed')
      const committed = await command(first.agent, 'git rev-parse HEAD')
      first.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Check without changes.' }], source: { kind: 'user' } }))
      await first.agent.whenIdle()
      expect(await command(first.agent, 'git rev-parse HEAD')).toBe(committed)
      expect(first.agent.session.snapshotEvents().filter(event => event.type === 'workspace/commit-message-request')).toHaveLength(1)
      let writer: ReturnType<typeof ctx.subprocess.spawn> | undefined
      const writerAgent = first.agent
      const unwatch = ctx.on('agent/pre-step', ({ agent }, next) => {
        if (agent === writerAgent && writer === undefined) writer = ctx.subprocess.spawn({
          argv: ['/bin/sh', '-c', 'while [ ! -f release-writer ]; do sleep 0.05; done; printf retained >background.txt; rm release-writer'],
          cwd: source, stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } }, graceMs: 1000,
        })
        return next()
      })
      first.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Finish while the background writer remains active.' }], source: { kind: 'user' } }))
      await first.agent.whenIdle()
      expect(first.agent.session.snapshotEvents().findLast(event => event.type === 'workspace/state')?.data)
        .toMatchObject({ phase: vmConfig === undefined ? 'pending' : 'returned', turn: 3 })
      const world = await ctx.conversationWorkspaces.runForSession(
        first.agent.id, async () => ctx.conversationWorkspaces.capture().containerName,
      )
      // The test owns the tmpfs roots; this external release proves settlement did not kill the writer.
      const slot = await Promise.all(poolPaths.map(async (slot) => {
        let owner: { workspaceId: string } | undefined
        try { owner = JSON.parse(await readFile(join(slot, 'owner.json'), 'utf8')) as { workspaceId: string } }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        return { slot, owner }
      }))
      const backing = slot.find(slot => slot.owner?.workspaceId === receipt.data.workspaceId)?.slot
      if (backing === undefined) throw new Error('writer workspace slot missing')
      const executionSource = ctx.agents.withInitiator(first.agent, () => ctx.conversationWorkspaces.executionPath(source))
      await writeFile(join(backing, 'workspace', executionSource.slice('/workspace'.length), 'release-writer'), '')
      if (writer === undefined) throw new Error('background writer did not start')
      expect((await writer.done).exitCode).toBe(0)
      unwatch()
      const savedAgent = first.agent
      await expect.poll(() => savedAgent.session.snapshotEvents().findLast(event => event.type === 'workspace/state')?.data,
        { timeout: 15000 }).toMatchObject({ phase: 'returned', turn: 3 })
      await ctx.conversationWorkspaces.runForSession(first.agent.id, async () => {
        expect(ctx.conversationWorkspaces.capture().containerName).not.toBe(world)
      })
      expect(await read(first.agent, 'background.txt')).toBe('retained')
      const started = Promise.withResolvers<undefined>()
      const secondId = second.agent.id
      ctx.on('agent/assistant-stream', ({ agent, frame }) => {
        if (agent.id === secondId && frame.type === 'chunk') started.resolve(undefined)
      })
      await command(second.agent, "printf 'cancelled work' >unfinished.txt")
      second.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Begin.' }], source: { kind: 'user' } }))
      await started.promise
      second.agent.cancel({ kind: 'user' }); await second.agent.whenIdle()
      expect(second.agent.session.snapshotEvents().findLast(event => event.type === 'workspace/state')?.data)
        .toMatchObject({ phase: 'checkpointed' })
      expect(await read(second.agent, 'unfinished.txt')).toBe('cancelled work')
    } finally {
      await first?.dispose(); await maintenance?.dispose()
      await second?.dispose(); await ctx.fiber.dispose()
      for (const slot of poolPaths) {
        try { workspaceIds.add((JSON.parse(await readFile(join(slot, 'owner.json'), 'utf8')) as { workspaceId: string }).workspaceId) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      }
      if (rawVm !== undefined) {
        const config = JSON.parse(rawVm) as { command: string; project: string }
        const listed = JSON.parse((await promisify(execFile)(config.command, ['--force-local', 'query', `/1.0/instances?project=${config.project}`])).stdout) as string[]
        for (const id of workspaceIds) if (listed.some(value => new URL(value, 'http://incus').pathname === `/1.0/instances/dsh-${id}`)) {
          await promisify(execFile)(config.command, ['--force-local', 'delete', `dsh-${id}`, '--project', config.project, '--force'])
        }
      }
      for (const slot of poolPaths) {
        let owner: { workspaceId: string }
        try { owner = JSON.parse(await readFile(join(slot, 'owner.json'), 'utf8')) as { workspaceId: string } }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
        if (workspaceIds.has(owner.workspaceId)) {
          await rm(join(slot, 'workspace'), { recursive: true, force: true })
          await rm(join(slot, 'owner.json'))
        }
      }
      await rm(root, { recursive: true, force: true })
    }
  })
})
